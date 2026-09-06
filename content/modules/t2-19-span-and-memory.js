CSPREP.module({
  id: "t2-19-span-and-memory",
  minutes: 55,
  updated: "2026-09-02",
  summary: "A Span is a view, not a copy - two fields on the stack pointing at memory somebody else owns. Ledger's settlement parser allocated 184 bytes per record and 73.6 MB across the file; the span version allocated 0 bytes per record. But the honest result is that the TIME barely moved, measured between 0.91x and 1.84x across runs: the win is allocation, not the clock. Memory<T> lifts every ref struct restriction and hands you the lifetime bug the compiler was preventing, demonstrated here as one customer reading another customer's record.",
  terms: ["Span", "ReadOnlySpan", "Memory", "ReadOnlyMemory", "ref struct", "view", "slice",
    "stackalloc", "contiguous memory", "aliasing", "bounds check", "IMemoryOwner", "MemoryPool",
    "MemoryMarshal", "CollectionsMarshal", "UTF-8 literal", "Utf8Parser", "TryFormat",
    "alternate lookup", "escape analysis"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger imports a settlement file every night: 400,000 fixed-width records, each one 42
  characters, each carrying an invoice reference, a currency, an amount and a date.</p>

  <p>The parser is the obvious code. For each line, pull out four fields and convert them:</p>

  <pre data-lang="csharp" data-net="10"><code>string invoice  = line.Substring(0, 16);
string currency = line.Substring(16, 3);
string amount   = line.Substring(19, 13);
string date     = line.Substring(32, 10);</code></pre>

  <p>Nothing about that is wrong. It is what everybody writes, it is correct, and it is readable.</p>

  <p>It also allocates four strings per line. Measured across the file:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   version        time        allocated       per record   gen0   gen2
   Substring         281 ms     73,603,512 B       184 B     22      0
   Span              220 ms            376 B         0 B      0      0</code></pre>

  <p><strong>73.6 megabytes of strings to read a file that is 16.8 megabytes.</strong> Every one of
  those 1.6 million strings is dead microseconds after it is created.</p>

  <p>The fix is to stop copying. The four fields already exist inside <code>line</code> — the parser
  does not need new strings, it needs to know <em>where in that string</em> each field starts and how
  long it is. That is exactly what <code>Span&lt;T&gt;</code> is: a reference and a length, describing
  a window onto memory somebody else already owns.</p>

  <p>Now the part most articles about spans leave out. Look at the time column again. 281 ms became
  220 ms — and across repeated runs that comparison measured anywhere from <strong>0.91x to
  1.84x</strong>, including runs where the span version was <em>slower</em>.</p>

  <p><strong>The allocation result is the robust one; the speed result is not.</strong> If you rewrite
  a parser expecting the clock to move, you will often be disappointed and will have made the code
  harder to read for nothing. This module is about what spans actually buy, where the boundary is,
  and the two situations — one of them a security bug — where reaching for them makes things worse.</p>
</section>

<section id="plain-language">
  <h2>A view, not a copy</h2>

  <p class="define"><span class="define__term">Contiguous memory</span> A run of bytes laid out one
  after another with no gaps. An array is contiguous; a linked list is not. Everything in this module
  requires it, because a view is described by a starting point and a count.</p>

  <p class="define"><span class="define__term">View</span> A description of <em>where</em> some data
  is, rather than a second copy of the data. Reading through a view reads the original. Writing
  through a view writes the original.</p>

  <p class="define"><span class="define__term">Span&lt;T&gt;</span> Two fields — a reference to the
  first element, and a length. It can point at an array, at the stack, or at unmanaged memory, and
  code using it does not know which.</p>

  <p class="define"><span class="define__term">ReadOnlySpan&lt;T&gt;</span> The same thing without the
  ability to write. This is the one you use most, and it is what <code>string.AsSpan()</code> gives
  you, because strings are immutable.</p>

  <p class="define"><span class="define__term">Slice</span> Making a narrower view from a wider one.
  It adjusts a pointer and a length; it copies nothing, at any depth.</p>

  <p>The defining property, demonstrated:</p>

  <pre data-lang="console" data-title="01-span-basics.cs"><code>   array  : [10, 20, 30, 40, 50]
   span   : [20, 30, 40]  (numbers.AsSpan(1, 3))

   after span[0] = 999:
   array  : [10, 999, 30, 40, 50]</code></pre>

  <p><strong>The array changed.</strong> The span did not hold a copy of element 1; it held the
  address of element 1. That is the whole idea, and it is also the whole danger — a span is valid only
  while the thing it points at is alive and unmoved.</p>

  <p><strong>An analogy, and its limits.</strong> A span is a pair of bookmarks in a book: "from page
  40 to page 60". The bookmarks are tiny, making a new pair is free, and you can make bookmarks inside
  bookmarks. What you must not do is take the bookmarks home and expect them to mean anything after
  the book has been reshelved, rebound, or given to someone else.</p>

  <p><strong>Where the analogy breaks:</strong> bookmarks in a real book are harmless when the book is
  gone — you are left holding two bits of card. A span pointing at memory that has been freed or reused
  reads whatever is there now, silently and without error. Later in this module that is exactly how
  one customer ends up reading another customer's record.</p>

  <h3>The three places a span can point at</h3>

  <pre data-lang="csharp" data-net="10" data-title="01-span-basics.cs"><code>static void ThreeKindsOfMemory()
{
    Console.WriteLine("2. The three places a Span can point at");
    Console.WriteLine();

    // (a) The managed heap: an array.
    int[] heapArray = new int[4];
    Span&lt;int&gt; fromHeap = heapArray;
    fromHeap[0] = 1;

    // (b) The stack: stackalloc. No heap allocation at all.
    Span&lt;int&gt; fromStack = stackalloc int[4];
    fromStack[0] = 2;

    // (c) Unmanaged memory, allocated and freed by hand. This is the only
    //     part of the file that needs unsafe, and it is why the file carries
    //     the AllowUnsafeBlocks property at the top.
    unsafe
    {
        void* native = System.Runtime.InteropServices.NativeMemory.Alloc(4, sizeof(int));
        try
        {
            Span&lt;int&gt; fromNative = new Span&lt;int&gt;(native, 4);
            fromNative[0] = 3;

            Console.WriteLine($"   heap span[0]      : {fromHeap[0]}");
            Console.WriteLine($"   stack span[0]     : {fromStack[0]}");
            Console.WriteLine($"   unmanaged span[0] : {fromNative[0]}");
        }
        finally
        {
            System.Runtime.InteropServices.NativeMemory.Free(native);
        }
    }

    Console.WriteLine();
    Console.WriteLine("   One type, three completely different kinds of memory. A method");
    Console.WriteLine("   taking Span&lt;int&gt; works with all three and does not know or care");
    Console.WriteLine("   which it was given. That is why span-based APIs compose so well.");
    Console.WriteLine();

    // A ReadOnlySpan over a string: the most common case in real code.
    string text = "INV-2026-0004821";
    ReadOnlySpan&lt;char&gt; id = text.AsSpan(4);
    Console.WriteLine($"   string           : {text}");
    Console.WriteLine($"   AsSpan(4)        : {id.ToString()}   (no new string was created)");
    Console.WriteLine();
}</code></pre>

  <pre data-lang="console" data-title="01-span-basics.cs"><code>   heap span[0]      : 1
   stack span[0]     : 2
   unmanaged span[0] : 3

   string           : INV-2026-0004821
   AsSpan(4)        : 2026-0004821   (no new string was created)</code></pre>

  <p class="define"><span class="define__term">stackalloc</span> A request for memory from the current
  method's stack frame rather than the heap. It is released when the method returns, costs nothing to
  allocate, and is never seen by the garbage collector.</p>

  <p>One type, three completely different kinds of memory. A method taking
  <code>Span&lt;int&gt;</code> works with all three and does not know which it was given — which is
  why span-based APIs compose so well across the BCL.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>A span is <strong>not</strong> unsafe, and it is not a pointer. Bounds are still checked:</p>
    <pre data-lang="console"><code>   array length : 10
   span length  : 4   (a window onto elements 2..5)
   span[4]      : IndexOutOfRangeException</code></pre>
    <p>Element 6 of the array exists and is valid memory. The span refuses anyway, because its length
    is 4. That is the difference between a span and a raw pointer, and it is why span code is safe
    code.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — A Span is a view, not a copy. That one sentence is
// the whole type.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

const string line = "INV-2026-0004821GBP0000001234502026-03-14";
const int iterations = 200_000;

// A view mutates what it looks at.
int[] numbers = { 10, 20, 30, 40, 50 };
numbers.AsSpan(1, 3)[0] = 999;
Console.WriteLine($"array after writing through a span: [{string.Join(", ", numbers)}]");
Console.WriteLine();

// A copy allocates. A view does not.
Console.WriteLine($"{iterations:N0} lines, four fields each:");
Console.WriteLine($"  Substring : {Measure(UseSubstring),12:N0} bytes");
Console.WriteLine($"  Slice     : {Measure(UseSlice),12:N0} bytes");
Console.WriteLine();
Console.WriteLine("Same fields, same answers, no copies.");

static long Measure(Func&lt;long&gt; body)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);
    long checksum = body();
    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

    // Returned so the loop cannot be optimised away, then discarded.
    _ = checksum;
    return allocated;
}

static long UseSubstring()
{
    long total = 0;
    for (int i = 0; i &lt; iterations; i++)
    {
        string currency = line.Substring(16, 3);
        string amount = line.Substring(19, 13);
        total += currency.Length + long.Parse(amount);
    }
    return total;
}

static long UseSlice()
{
    long total = 0;
    for (int i = 0; i &lt; iterations; i++)
    {
        ReadOnlySpan&lt;char&gt; currency = line.AsSpan(16, 3);
        ReadOnlySpan&lt;char&gt; amount = line.AsSpan(19, 13);
        total += currency.Length + long.Parse(amount);
    }
    return total;
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>array after writing through a span: [10, 999, 30, 40, 50]

200,000 lines, four fields each:
  Substring :   16,000,336 bytes
  Slice     :          336 bytes

Same fields, same answers, no copies.</code></pre>

  <p>16 megabytes against 336 bytes, for identical answers. The 336 bytes is fixed setup — it does not
  grow with the number of lines, which is the property that matters.</p>
</section>

<section id="slicing">
  <h2>Slicing, and what it costs</h2>

  <pre data-lang="console" data-title="01-span-basics.cs"><code>   1,000,000 iterations, four nested slices each
   bytes allocated : 40
   time            : 19 ms</code></pre>

  <p>Four million slices for 40 bytes of fixed setup. Slicing constructs a new span from an old one
  with an adjusted reference and length, on the stack. Nothing touches the heap, at any depth.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Range syntax means <strong>completely different things</strong> on an array and on a span, and
    they look identical at the call site. Measured, 100,000 calls each:</p>
    <pre data-lang="console"><code>   array[..] via ToArray()      42,400,000 B   ( 424.0 B per call)
   AsSpan().Slice()                    336 B   (   0.0 B per call)
   string.Substring(0, 10)       4,800,336 B   (  48.0 B per call)
   string.AsSpan(0, 10)                336 B   (   0.0 B per call)</code></pre>
    <p><code>array[..100]</code> calls <code>RuntimeHelpers.GetSubArray</code>, which
    <strong>copies</strong>. <code>array.AsSpan()[..100]</code> slices, which does not. One character
    of difference, 424 bytes per call.</p>
  </div>

  <h3>The parse methods are what make it work</h3>

  <p>A span-based parser only avoids allocation if everything downstream accepts a span. Fortunately
  the BCL was reworked for this:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Instead of</th><th>Use</th></tr>
      </thead>
      <tbody>
        <tr><td><code>int.Parse(string)</code></td><td><code>int.Parse(ReadOnlySpan&lt;char&gt;)</code> — every numeric type</td></tr>
        <tr><td><code>DateTime.ParseExact(string, ...)</code></td><td><code>DateTime.ParseExact(ReadOnlySpan&lt;char&gt;, ...)</code></td></tr>
        <tr><td><code>a == b</code> on substrings</td><td><code>span.SequenceEqual(other)</code></td></tr>
        <tr><td><code>text.IndexOf(char)</code></td><td><code>span.IndexOf(char)</code> — plus <code>IndexOfAny</code>, <code>ContainsAny</code></td></tr>
        <tr><td><code>value.ToString(format)</code></td><td><code>value.TryFormat(span, out int written, format)</code></td></tr>
        <tr><td><code>Encoding.UTF8.GetString(bytes)</code></td><td>Work on the bytes with <code>Utf8Parser</code></td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Check this before rewriting anything.</strong> If the API you need has no span overload,
  you will convert back to a string to call it and reintroduce exactly the allocation you removed.</p>

  <h3>Splitting without allocating</h3>

  <p><code>string.Split</code> allocates the array <em>and</em> every element — six objects for a
  five-field line. Walking the span allocates neither:</p>

  <pre data-lang="csharp" data-net="10" data-title="Walking to a field without allocating"><code>static long ThirdField(ReadOnlySpan&lt;char&gt; line)
{
    int field = 0;
    while (true)
    {
        int comma = line.IndexOf(',');
        ReadOnlySpan&lt;char&gt; current = comma &lt; 0 ? line : line[..comma];

        if (field == 2)
        {
            return long.Parse(current, System.Globalization.CultureInfo.InvariantCulture);
        }

        if (comma &lt; 0)
        {
            return 0;
        }

        line = line[(comma + 1)..];
        field++;
    }
}</code></pre>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   version           allocated      per line     time
   string.Split    59,201,024 B       296 B       55 ms
   span walk              672 B         0 B        8 ms</code></pre>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>.NET 8 added <code>MemoryExtensions.Split</code>, which fills a caller-supplied
    <code>Span&lt;Range&gt;</code> with the field boundaries rather than allocating strings. It is
    worth preferring to a hand-written walk when the field count is known and small.</p>
  </div>
</section>

<section id="ref-struct-rules">
  <h2>Why a span cannot go everywhere</h2>

  <p class="define"><span class="define__term">ref struct</span> A type the compiler guarantees will
  only ever live on the stack. <code>Span&lt;T&gt;</code> is one. Every restriction in this section
  follows from that single guarantee.</p>

  <p>The reasoning is short and worth holding rather than memorising the list. A span holds a
  reference into somebody else's memory. If a span could be stored on the heap, it could outlive what
  it points at, and reading it would then read freed or reused memory. So the compiler forbids every
  route by which a span could reach the heap.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Forbidden</th><th>Error</th><th>Because</th></tr>
      </thead>
      <tbody>
        <tr><td>Field of a class</td><td><code>CS8345</code></td><td>The class is on the heap</td></tr>
        <tr><td>Preserved across an <code>await</code> or <code>yield</code></td><td><code>CS4007</code></td><td>The state machine is a heap object</td></tr>
        <tr><td>Captured by a lambda</td><td><code>CS8175</code></td><td>The closure is a heap object</td></tr>
        <tr><td>Assigned to <code>object</code></td><td><code>CS0029</code></td><td>Boxing copies to the heap</td></tr>
        <tr><td>Used as a generic argument</td><td><code>CS9244</code></td><td>Could be boxed or stored</td></tr>
        <tr><td>Element of an array</td><td><code>CS0611</code></td><td>The array is on the heap</td></tr>
        <tr><td>Returned pointing at your own stack</td><td><code>CS8352</code></td><td>The frame is gone on return</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Two of the error codes usually quoted for these rules are <strong>wrong on .NET 10</strong>,
    and both appear widely in blog posts and answers. The async/iterator rule is
    <strong>CS4007</strong>, not CS4013. The generic-argument rule is <strong>CS9244</strong>, not
    CS0306.</p>
    <p>Every code in the table above was captured by compiling each rule as a separate file, because
    the compiler stops at the first declaration-level error and will not report the rest from one
    file.</p>
  </div>

  <h3>The rule that is usually taught wrong</h3>

  <p>"You cannot use a <code>Span</code> in an async method" is the common phrasing, and it is
  <strong>false</strong>. Read the actual error text:</p>

  <pre data-lang="text" data-title="The compiler's wording"><code>error CS4007: Instance of type 'System.Span&lt;byte&gt;' cannot be
preserved across 'await' or 'yield' boundary.</code></pre>

  <p><em>Preserved across.</em> A span created and finished with before the <code>await</code>
  compiles perfectly well, because nothing has to survive into the state machine:</p>

  <pre data-lang="csharp" data-net="10" data-title="Legal - verified to compile"><code>public async Task ProcessAsync(Stream source, CancellationToken ct)
{
    // Created, used and finished with BEFORE the await. Nothing to preserve.
    Span&lt;byte&gt; header = stackalloc byte[8];
    header[0] = 1;
    int checksum = header[0];

    await source.ReadAsync(new byte[8], ct);

    // A second span AFTER the await is equally fine.
    Span&lt;byte&gt; footer = stackalloc byte[8];
    footer[0] = (byte)checksum;
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="CS4007 - the span has to survive the await"><code>public async Task ProcessAsync(Stream source, CancellationToken ct)
{
    Span&lt;byte&gt; buffer = stackalloc byte[256];
    await source.ReadAsync(new byte[256], ct);
    buffer[0] = 1;              // used AFTER the await, so it must be preserved
}</code></pre>

  <p>The same distinction applies to iterators, and the demonstration is neat: <strong>one
  <code>yield return</code> after the span compiles; two does not</strong>, because with two the span
  must survive the first boundary.</p>

  <p>This matters in practice because it means the correct pattern in async code is not "give up and
  use <code>Memory</code> everywhere". It is: <strong>hold <code>Memory&lt;T&gt;</code> across the
  awaits, and take a <code>Span&lt;T&gt;</code> from it inside each synchronous stretch.</strong></p>
</section>

<section id="memory">
  <h2><code>Memory&lt;T&gt;</code>, and the safety it gives up</h2>

  <p class="define"><span class="define__term">Memory&lt;T&gt;</span> An ordinary struct — not a ref
  struct — holding an object reference, an offset and a length. Because it is ordinary, it can be a
  field, be captured, and live across an <code>await</code>. It cannot be indexed directly; you call
  <code>.Span</code> to get a span for the synchronous stretch that uses it.</p>

  <pre data-lang="console" data-title="03-memory-and-async.cs"><code>   sizeof(Memory&lt;byte&gt;)     : 16 bytes
   memory.Length            : 20

   recovered array length   : 100
   recovered offset         : 10
   recovered count          : 20
   same array instance?     : True</code></pre>

  <p>That recovery, via <code>MemoryMarshal.TryGetArray</code>, is proof of what the struct holds: the
  original array, an offset, and a count.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th></th><th><code>Span&lt;T&gt;</code></th><th><code>Memory&lt;T&gt;</code></th></tr>
      </thead>
      <tbody>
        <tr><td>Can be a field of a class</td><td>No</td><td>Yes</td></tr>
        <tr><td>Can cross an <code>await</code></td><td>No</td><td>Yes</td></tr>
        <tr><td>Can be captured by a lambda</td><td>No</td><td>Yes</td></tr>
        <tr><td>Can point at the stack</td><td>Yes</td><td>No</td></tr>
        <tr><td>Indexable directly</td><td>Yes</td><td>No — via <code>.Span</code></td></tr>
        <tr><td>Compiler prevents it outliving its target</td><td><strong>Yes</strong></td><td><strong>No</strong></td></tr>
      </tbody>
    </table>
  </div>

  <p>Read the last row carefully, because it is the trade. Every restriction removed is a safety
  guarantee removed. <strong>Nothing stops you holding a <code>Memory&lt;T&gt;</code> longer than the
  memory it points at remains yours.</strong></p>

  <h3>The bug this makes possible</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Returns a view of a buffer it gave away"><code>static Memory&lt;char&gt; BadlyReadStatement(string source)
{
    char[] buffer = ArrayPool&lt;char&gt;.Shared.Rent(64);
    source.AsSpan().CopyTo(buffer);

    // WRONG: returning a view over a buffer we are about to give back.
    Memory&lt;char&gt; result = buffer.AsMemory(0, source.Length);
    ArrayPool&lt;char&gt;.Shared.Return(buffer);
    return result;
}</code></pre>

  <pre data-lang="console" data-title="03-memory-and-async.cs"><code>   what the caller was given : "CUSTOMER-000512 GBP 1234.50"
   after another tenant rents: "ATTACKER-999 USD 0.01XXXXXX"</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The caller's data changed underneath them without anyone touching their variable. They are now
    reading a different customer's record. <strong>This is a data-disclosure bug, not a performance
    bug</strong>, and it reproduces on every run.</p>
    <p><code>Span&lt;T&gt;</code> cannot have this failure — <code>CS8352</code> would refuse to let
    the view escape the method. Every ref struct restriction you found annoying was preventing
    exactly this.</p>
  </div>

  <h3>Making the lifetime a contract</h3>

  <p class="define"><span class="define__term">IMemoryOwner&lt;T&gt;</span> An
  <code>IDisposable</code> that owns a block of memory and exposes it as
  <code>Memory&lt;T&gt;</code>. Disposing it releases the block. It exists so ownership can be
  transferred explicitly instead of implied.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-memory-and-async.cs"><code>static async Task OwnershipDoneRight()
{
    Console.WriteLine("5. RIGHT - IMemoryOwner makes the lifetime a contract");
    Console.WriteLine();

    // The caller receives the OWNER, not a bare Memory. Disposing it is what
    // returns the buffer, so the lifetime is visible in the calling code.
    using (IMemoryOwner&lt;char&gt; owner = ReadStatement("CUSTOMER-000512 GBP 1234.50", out int length))
    {
        Memory&lt;char&gt; statement = owner.Memory[..length];
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
    Console.WriteLine("   Returning a bare Memory&lt;T&gt; over a pooled buffer is not on the list.");

    static IMemoryOwner&lt;char&gt; ReadStatement(string source, out int length)</code></pre>

  <p>The three options, in order of preference:</p>

  <ol>
    <li><strong>Return a <code>Span</code></strong> and let the compiler prove it cannot escape.</li>
    <li><strong>Return an <code>IMemoryOwner&lt;T&gt;</code></strong> and let the caller dispose it.
    The lifetime is then visible in the calling code and in the signature.</li>
    <li><strong>Copy into a caller-supplied buffer</strong> and return the count written. This is the
    BCL's own convention.</li>
  </ol>

  <p>Returning a bare <code>Memory&lt;T&gt;</code> over a pooled buffer is not on the list.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>.Span</code> is cheap but not free — measured at about 5 ns per call, because it
    re-derives the reference and length each time. In a hot loop take it <em>once</em> outside the
    loop rather than per iteration.</p>
  </div>
</section>

<section id="production">
  <h2>The Ledger settlement parser</h2>

  <p>The original, and the span rewrite, doing identical work:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="The version that shipped"><code>static Result ParseWithStrings(string[] lines)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    int g0 = GC.CollectionCount(0), g2 = GC.CollectionCount(2);
    var sw = Stopwatch.StartNew();

    long totalMinor = 0;
    int gbpCount = 0;

    foreach (string line in lines)
    {
        string invoice = line.Substring(0, 16);
        string currency = line.Substring(16, 3);
        string amount = line.Substring(19, 13);
        string date = line.Substring(32, 10);

        long minor = long.Parse(amount, CultureInfo.InvariantCulture);
        DateOnly parsedDate = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);

        totalMinor += minor;
        if (currency == "GBP")
        {
            gbpCount++;
        }

        // Keep the compiler from removing the unused locals.
        if (invoice.Length == 0 || parsedDate.Year == 1)
        {
            throw new InvalidOperationException("unreachable");
        }
    }

    sw.Stop();</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="The span version - same logic, no copies"><code>static Result ParseWithSpans(string[] lines)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    int g0 = GC.CollectionCount(0), g2 = GC.CollectionCount(2);
    var sw = Stopwatch.StartNew();

    long totalMinor = 0;
    int gbpCount = 0;

    foreach (string line in lines)
    {
        ReadOnlySpan&lt;char&gt; span = line;

        ReadOnlySpan&lt;char&gt; invoice = span[..16];
        ReadOnlySpan&lt;char&gt; currency = span.Slice(16, 3);
        ReadOnlySpan&lt;char&gt; amount = span.Slice(19, 13);
        ReadOnlySpan&lt;char&gt; date = span.Slice(32, 10);

        long minor = long.Parse(amount, CultureInfo.InvariantCulture);
        DateOnly parsedDate = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);

        totalMinor += minor;

        // SequenceEqual compares content without allocating either side.
        if (currency.SequenceEqual("GBP"))
        {
            gbpCount++;
        }

        if (invoice.Length == 0 || parsedDate.Year == 1)
        {
            throw new InvalidOperationException("unreachable");
        }
    }

    sw.Stop();
    return new Result("Span", sw.Elapsed.TotalMilliseconds,
        GC.GetTotalAllocatedBytes(precise: true) - allocBefore,</code></pre>

  <pre data-lang="console" data-title="04-production.cs"><code>   version        time        allocated       per record   gen0   gen2
   -------        ----        ---------       ----------   ----   ----
   Substring         281 ms     73,603,512 B       184 B     22      0
   Span              220 ms            376 B         0 B      0      0
   UTF-8 bytes        15 ms            336 B         0 B      0      0

   Correctness check (all three must agree):
     totals    : 17039800000 / 17039800000 / 17039800000
     GBP counts: 133334 / 133334 / 133334
     agree     : True</code></pre>

  <h3>Reading this honestly</h3>

  <p><strong>Allocation is the robust result.</strong> 184 bytes per record becomes 0. That figure is
  deterministic and reproduces exactly on every run, and the gen 0 column follows it: 22 collections
  against none.</p>

  <p><strong>Time, for span against substring, is not a robust result.</strong> Across repeated runs
  it measured between <strong>0.91x and 1.84x</strong> — including runs where the span version was
  slower. The reason is in the gen 0 column: those 1.6 million strings all die in generation 0, which
  is the cheapest thing the collector does. Removing cheap work does not move the clock much on one
  run of a loop.</p>

  <p>It moves the clock on a <em>service</em>, where that allocation competes with every other request
  for the same collector, and where the pause it eventually causes lands on somebody else's request.
  That is the argument for the rewrite, and it is worth making accurately rather than promising a
  speed-up that does not reliably appear.</p>

  <h3>The version that does move the clock</h3>

  <p class="define"><span class="define__term">UTF-8 literal</span> A string literal suffixed with
  <code>u8</code>, producing a <code>ReadOnlySpan&lt;byte&gt;</code> of UTF-8 bytes at compile time
  with no allocation and no encoding step at runtime.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>static Result ParseUtf8(string[] lines)
{
    // Encode once, outside the measurement: this stands in for bytes arriving
    // from a stream, which is how the real file is read.
    byte[][] utf8Lines = new byte[lines.Length][];
    for (int i = 0; i &lt; lines.Length; i++)
    {
        utf8Lines[i] = Encoding.UTF8.GetBytes(lines[i]);
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    int g0 = GC.CollectionCount(0), g2 = GC.CollectionCount(2);
    var sw = Stopwatch.StartNew();

    long totalMinor = 0;
    int gbpCount = 0;

    // A UTF-8 literal. No allocation, no encoding step at comparison time.
    ReadOnlySpan&lt;byte&gt; gbp = "GBP"u8;

    foreach (byte[] lineBytes in utf8Lines)
    {
        ReadOnlySpan&lt;byte&gt; span = lineBytes;

        ReadOnlySpan&lt;byte&gt; invoice = span[..16];
        ReadOnlySpan&lt;byte&gt; currency = span.Slice(16, 3);
        ReadOnlySpan&lt;byte&gt; amount = span.Slice(19, 13);
        ReadOnlySpan&lt;byte&gt; date = span.Slice(32, 10);

        // Utf8Parser reads numbers straight out of the bytes.
        System.Buffers.Text.Utf8Parser.TryParse(amount, out long minor, out _);

        // The same date, parsed from bytes. This is here so the three
        // versions do identical work - without it the comparison would be
        // measuring a parser that skips a field.
        DateOnly parsedDate = ParseIsoDate(date);

        totalMinor += minor;
        if (currency.SequenceEqual(gbp))
        {
            gbpCount++;
        }

        if (invoice.Length == 0 || parsedDate.Year == 1)
        {
            throw new InvalidOperationException("unreachable");
        }
    }

    sw.Stop();
    return new Result("UTF-8 bytes", sw.Elapsed.TotalMilliseconds,
        GC.GetTotalAllocatedBytes(precise: true) - allocBefore,
        GC.CollectionCount(0) - g0, GC.CollectionCount(2) - g2, totalMinor, gbpCount);
}

// yyyy-MM-dd, straight from ASCII bytes. Digit arithmetic rather than a</code></pre>

  <p>Measured at 12x to 18x across runs — a genuine, repeatable speed-up. But be precise about why,
  because two changes are bundled together:</p>

  <ol>
    <li>It never decodes bytes into UTF-16 chars at all. The file arrives as bytes; decoding doubles
    the size and buys nothing when the fields are ASCII identifiers and digits.</li>
    <li>It parses the date with digit arithmetic instead of <code>DateOnly.ParseExact</code>.</li>
  </ol>

  <p>The second is doing a large share of the work. Attributing all of it to "spans are fast" would be
  the wrong lesson.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's importer runs on a pod with a 512 MB limit. At 184 bytes per record and 400,000
    records the parse allocates 73.6 MB per file — and the importer processes 30 files a night, so
    2.2 GB passes through the collector for a job whose live data never exceeds a few megabytes.</p>
    <p>The pod was being restarted by its liveness probe twice a week. Not because it ran out of
    memory, but because generation 0 collections during the import made the health endpoint miss its
    timeout. <strong>The fix was not a faster parser; it was a parser that stopped generating
    garbage.</strong></p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. stackalloc with a size from input</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Kills the process, uncatchably"><code>public void Process(string request)
{
    // WRONG. A 2 MB request overflows the 1 MB default thread stack.
    // A stack overflow CANNOT BE CAUGHT: no exception, no finally blocks,
    // no logging, no graceful shutdown. The process is gone.
    Span&lt;char&gt; buffer = stackalloc char[request.Length];
    request.AsSpan().CopyTo(buffer);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="A fixed stack ceiling with a pooled fallback"><code>public long Process(int length)
{
    // The constant caps the STACK cost, so input size cannot affect it.
    const int StackLimit = 256;

    byte[]? rented = null;
    Span&lt;byte&gt; buffer = length &lt;= StackLimit
        ? stackalloc byte[StackLimit]
        : (rented = System.Buffers.ArrayPool&lt;byte&gt;.Shared.Rent(length));

    try
    {
        buffer = buffer[..length];

        for (int i = 0; i &lt; buffer.Length; i++)
        {
            buffer[i] = (byte)i;
        }

        long sum = 0;
        foreach (byte b in buffer)
        {
            sum += b;
        }

        return sum;
    }
    finally
    {
        if (rented is not null)
        {
            System.Buffers.ArrayPool&lt;byte&gt;.Shared.Return(rented);
        }
    }
}</code></pre>

  <h3>2. stackalloc inside a loop</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Needs 2.5 MB of stack"><code>foreach (Record record in records)   // 10,000 records
{
    // WRONG: the allocation is released when the METHOD returns, not at the
    // end of the iteration. Ten thousand iterations at 256 bytes each need
    // 2.5 MB of stack, and the default is 1 MB.
    Span&lt;byte&gt; buffer = stackalloc byte[256];
    Format(record, buffer);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Allocate once, outside"><code>Span&lt;byte&gt; buffer = stackalloc byte[256];

foreach (Record record in records)
{
    // Clear only if the formatter does not overwrite everything it reads.
    buffer.Clear();
    Format(record, buffer);
}</code></pre>

  <h3>3. Overlapping slices and a hand-written copy loop</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   before        : [1, 2, 3, 4, 5, 6]
   after CopyTo  : [1, 1, 2, 3, 5, 6]
   after loop    : [1, 1, 1, 1, 5, 6]</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Reads what it has already overwritten"><code>// WRONG when the source and destination overlap, which slices of one
// buffer routinely do.
for (int i = 0; i &lt; 3; i++)
{
    span[i + 1] = span[i];
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="CopyTo handles overlap"><code>// Detects the overlap and copies in the safe direction, like memmove.
span[..3].CopyTo(span[1..4]);</code></pre>

  <p>With separate arrays you would never have hit this. Slices of one buffer can overlap, so it
  becomes a real bug class the moment you start using spans.</p>

  <h3>4. Holding a span over a collection that grows</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   list capacity 4, after write through span : [100, 2, 3]
   after Add within capacity (4)      : [100, 200, 3, 4]   span still valid
   after Add that resized to 8        : [100, 200, 3, 4, 5]   span now stale</code></pre>

  <p>Read the last two lines together. The write of 200 landed on the list. The write of 300 did
  not — index 2 still reads 3. It went to the array the list abandoned when it grew.</p>

  <p><strong>Same code, same span variable, opposite outcomes</strong>, decided entirely by whether an
  <code>Add</code> happened to cross the capacity boundary. There is no error and no warning. Take the
  span after all mutation, and never hold it across anything that can add to the collection.</p>

  <h3>5. Returning a span from a method that owns the buffer</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="CS8352, and the compiler is right"><code>public Span&lt;byte&gt; MakeBuffer()
{
    Span&lt;byte&gt; buffer = stackalloc byte[64];
    return buffer;              // CS8352: the stack frame is gone on return
}</code></pre>

  <p>The compiler refuses. The correct signatures are the caller-supplies-the-buffer forms:</p>

  <pre data-lang="csharp" data-net="10" data-title="The BCL convention"><code>// The caller owns the buffer, so nothing can outlive it. Too-small is a
// false return rather than an exception, because a caller sizing a buffer
// will hit it routinely.
public static bool TryFormatReference(long value, Span&lt;char&gt; destination, out int charsWritten)
{
    charsWritten = 0;

    // Check BEFORE writing, so a failed call leaves the buffer untouched
    // rather than half-written.
    if (destination.Length &lt; 14)
    {
        return false;
    }

    "REF-".AsSpan().CopyTo(destination);

    if (!value.TryFormat(destination[4..], out int digits, "D10",
            System.Globalization.CultureInfo.InvariantCulture))
    {
        return false;
    }

    charsWritten = 4 + digits;
    return true;
}</code></pre>

  <h3>6. Rewriting code where the result must be a string anyway</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   The result has to be a string (it is a dictionary key):

     direct Substring : 11,201,040 B       31 ms
     via span         : 11,201,000 B       10 ms</code></pre>

  <p>Identical allocation, because <code>ToString()</code> allocates exactly what
  <code>Substring</code> did. The span added a step and bought nothing.</p>

  <p class="define"><span class="define__term">Alternate lookup</span> A .NET 9 feature letting you
  probe a <code>Dictionary&lt;string, T&gt;</code> with a <code>ReadOnlySpan&lt;char&gt;</code>,
  allocating a string only when you actually insert.</p>

  <pre data-lang="csharp" data-net="10" data-title="Probe with a span, allocate only on insert"><code>var dictionary = new Dictionary&lt;string, long&gt;(StringComparer.Ordinal);
var lookup = dictionary.GetAlternateLookup&lt;ReadOnlySpan&lt;char&gt;&gt;();

// 200,000 probes measured 808 bytes total - the string is never created.
if (lookup.TryGetValue(line.AsSpan(0, 16), out long value))
{
    Process(value);
}</code></pre>

  <p>Note the comparer must be explicit — <code>StringComparer.Ordinal</code> — because the default
  comparer does not support alternate lookups.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> high allocation rate with a flat heap, or garbled/wrong data that
    changes depending on load.</p>
    <p><strong>Tools:</strong> allocation measurement first (it is three lines and needs no
    profiler), then <code>dotnet-counters</code>, then a memory profiler for the call sites.</p>
  </div>

  <h3>Step 1: measure allocation, not time</h3>

  <p>This is the whole diagnostic for the performance half of the module, and it needs no tooling:</p>

  <pre data-lang="csharp" data-net="10" data-title="Worth putting in a test"><code>long before = GC.GetTotalAllocatedBytes(precise: true);

ParseSettlementFile(lines);

long perRecord = (GC.GetTotalAllocatedBytes(precise: true) - before) / lines.Length;
Console.WriteLine($"allocated {perRecord} bytes per record");</code></pre>

  <p>Assert on it. A regression test that fails when bytes-per-record rises is worth more than any
  amount of profiling after the fact, because the number is <strong>deterministic</strong> — unlike
  the timing, which varied by a factor of two across runs of the same code.</p>

  <h3>Step 2: find where the allocation is</h3>

  <pre data-lang="bash"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime
dotnet-trace collect --process-id 4821 --profile gc-verbose</code></pre>

  <p>Open the trace in PerfView or Visual Studio and look at allocations by type.
  <code>System.String</code> at the top of a parsing service means substrings; a large
  <code>System.Object[]</code> count often means <code>string.Split</code>.</p>

  <h3>Step 3: when the data is wrong rather than slow</h3>

  <p>Corrupted or cross-contaminated data from span code has a short list of causes, and they are
  worth checking in this order:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Check</th><th>Symptom it explains</th></tr>
      </thead>
      <tbody>
        <tr><td>A <code>Memory&lt;T&gt;</code> retained after the buffer was returned to a pool</td><td>Data changes under load; one user sees another user's values</td></tr>
        <tr><td>A rented buffer used by <code>.Length</code> rather than the count written</td><td>Trailing garbage from a previous tenant</td></tr>
        <tr><td>A buffer returned to the pool without <code>clearArray: true</code></td><td>Stale data visible to the next tenant</td></tr>
        <tr><td>A span held across a collection resize</td><td>Writes silently lost, reads stale</td></tr>
        <tr><td>Overlapping slices with a hand-written copy loop</td><td>Repeated values where a shift was intended</td></tr>
      </tbody>
    </table>
  </div>

  <p>Every one of these is invisible to the type system and none produces an exception. That is the
  cost of the performance, and it is why spans belong on measured hot paths rather than everywhere.</p>

  <h3>Step 4: let the analysers help</h3>

  <pre data-lang="xml" data-title="Directory.Build.props"><code>&lt;PropertyGroup&gt;
  &lt;AnalysisMode&gt;Recommended&lt;/AnalysisMode&gt;

  &lt;!-- CA1859 prefers concrete types on hot paths; CA1846 prefers AsSpan
       over Substring; CA2022 catches an inexact Stream.Read that a span
       rewrite makes easy to introduce. --&gt;
  &lt;WarningsAsErrors&gt;$(WarningsAsErrors);CA1846;CA2022&lt;/WarningsAsErrors&gt;
&lt;/PropertyGroup&gt;</code></pre>

  <p><strong>CA1846</strong> flags <code>Substring</code> where <code>AsSpan</code> would do, which
  finds most of the opportunities in an existing codebase without any judgement on your part.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Spans make code faster."</strong></p>
    <p>Spans make code <em>allocate less</em>, and the two are not the same. Measured on a realistic
    400,000-record parse, the span version's time ranged from 0.91x to 1.84x the original across
    runs — sometimes slower. The allocation went from 184 bytes per record to 0, every run.</p>
    <p>Argue for a span rewrite on allocation and GC pressure. Do not promise a speed-up.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"You cannot use a Span in an async method."</strong></p>
    <p>You cannot <em>preserve one across an await</em>, which is what CS4007 says. A span created and
    finished with before the await compiles fine — verified. The same distinction applies to
    iterators: one <code>yield return</code> after a span is legal, two is not.</p>
    <p>The right pattern is <code>Memory&lt;T&gt;</code> across the awaits and
    <code>Span&lt;T&gt;</code> inside each synchronous stretch.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Memory&lt;T&gt; is Span&lt;T&gt; that works in async, so use it
    everywhere."</strong></p>
    <p>It is <code>Span&lt;T&gt;</code> with the safety removed. The compiler can no longer prove the
    view does not outlive its target, and the failure that follows is silent data corruption — one
    customer reading another customer's record, reproduced on every run in this module.</p>
    <p>Use <code>Span</code> wherever it compiles. Reach for <code>Memory</code> when you genuinely
    must cross an await or store a view in a field.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"stackalloc is free, so use it for everything."</strong></p>
    <p>It is free to allocate and fatal to overrun. A stack overflow cannot be caught: no exception,
    no <code>finally</code> blocks, no logging, no graceful shutdown. Only ever
    <code>stackalloc</code> a compile-time constant, never inside a loop, and always with a pooled
    fallback for anything larger.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"array[..100] and span[..100] do the same thing."</strong></p>
    <p>The first copies 100 elements; the second copies nothing. Measured at 424 bytes per call
    against 0. The syntax is identical and the cost is not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A span is unsafe code."</strong></p>
    <p>Bounds are checked exactly as they are for arrays — measured, an index past the span's length
    throws <code>IndexOutOfRangeException</code> even when the underlying array has an element there.
    A span cannot read outside the window it was given, which is precisely what separates it from a
    pointer.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Rewriting with spans is always worth it."</strong></p>
    <p>Three cases where it is not, one of them measured: the value has to become a string anyway
    (identical allocation, no saving); the API you need has no span overload (you convert back and
    lose everything); or the code is not hot (you have made it harder to read, and unusable in async
    and LINQ, for nothing).</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's API allocates 832 bytes per request. At 5,000 requests per second that is 4.0 MB/s,
    or 13.9 GB per hour — and it is completely fine, because those objects die in generation 0.</p>
    <p>The settlement importer allocates 73.6 MB per file and processes 30 files a night. Its live
    data never exceeds a few megabytes. The difference is that the importer's allocation arrives in a
    concentrated burst that starves everything sharing the pod, and the observable symptom was a
    health endpoint timing out, not a memory error.</p>
    <p>After the rewrite: 0 bytes per record, 0 generation 0 collections during the parse, and the
    liveness probe stopped firing. The wall-clock time of the import barely changed.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Reach for</th></tr>
      </thead>
      <tbody>
        <tr><td>Parsing fixed-width or delimited text on a hot path</td><td><code>ReadOnlySpan&lt;char&gt;</code> plus the span parse overloads</td></tr>
        <tr><td>The data arrives as UTF-8 bytes and the fields are ASCII</td><td><code>ReadOnlySpan&lt;byte&gt;</code>, <code>u8</code> literals, <code>Utf8Parser</code></td></tr>
        <tr><td>A small, fixed-size scratch buffer</td><td><code>stackalloc</code> with a constant size</td></tr>
        <tr><td>A buffer whose size depends on input</td><td><code>ArrayPool&lt;T&gt;</code>, with a <code>stackalloc</code> fast path</td></tr>
        <tr><td>A buffer that must cross an <code>await</code></td><td><code>Memory&lt;T&gt;</code>, taking <code>.Span</code> per synchronous stretch</td></tr>
        <tr><td>Handing a buffer to a caller</td><td><code>IMemoryOwner&lt;T&gt;</code>, or have them supply it</td></tr>
        <tr><td>Probing a dictionary without allocating a key</td><td><code>GetAlternateLookup&lt;ReadOnlySpan&lt;char&gt;&gt;()</code></td></tr>
        <tr><td>The result has to be a string anyway</td><td>Nothing. Keep the <code>Substring</code>.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Which of these allocate, and how much? Answer before running anything.</p>
    <pre data-lang="csharp" data-net="10"><code>int[] source = new int[1000];

var a = source[..100];
var b = source.AsSpan(0, 100);
var c = source.AsSpan(0, 100).ToArray();
var d = "0123456789abcdef".Substring(0, 10);
var e = "0123456789abcdef".AsSpan(0, 10);</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>Measured over 100,000 calls each:</p>
        <pre data-lang="console"><code>   array[..] via ToArray()      42,400,000 B   ( 424.0 B per call)
   AsSpan().Slice()                    336 B   (   0.0 B per call)
   AsSpan().ToArray()           42,400,336 B   ( 424.0 B per call)
   string.Substring(0, 10)       4,800,336 B   (  48.0 B per call)
   string.AsSpan(0, 10)                336 B   (   0.0 B per call)</code></pre>
        <div class="table-wrap">
          <table>
            <thead><tr><th></th><th>Allocates</th><th>Why</th></tr></thead>
            <tbody>
              <tr><td><code>a</code></td><td><strong>424 B</strong></td><td>Range on an <em>array</em> calls <code>GetSubArray</code>, which copies. 100 ints plus a 24-byte header.</td></tr>
              <tr><td><code>b</code></td><td>0</td><td>A view. Two fields on the stack.</td></tr>
              <tr><td><code>c</code></td><td><strong>424 B</strong></td><td><code>ToArray</code> is an explicit copy — the point of it.</td></tr>
              <tr><td><code>d</code></td><td><strong>48 B</strong></td><td>A new string: 10 chars at 2 bytes each, plus header and length.</td></tr>
              <tr><td><code>e</code></td><td>0</td><td>A view over the existing string's characters.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The trap is <code>a</code>.</strong> <code>array[..100]</code> and
        <code>array.AsSpan()[..100]</code> differ by seven characters and by 424 bytes per call.
        Range syntax on an array copies; on a span it slices.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Why does this not compile, and what is the smallest change that fixes it?</p>
    <pre data-lang="csharp" data-net="10"><code>public async Task&lt;int&gt; CountDigitsAsync(Stream source, CancellationToken ct)
{
    Span&lt;byte&gt; buffer = stackalloc byte[256];
    int read = await source.ReadAsync(new byte[256], ct);

    int digits = 0;
    for (int i = 0; i &lt; read; i++)
    {
        if (buffer[i] &gt;= (byte)'0' &amp;&amp; buffer[i] &lt;= (byte)'9')
        {
            digits++;
        }
    }

    return digits;
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="text"><code>error CS4007: Instance of type 'System.Span&lt;byte&gt;' cannot be
preserved across 'await' or 'yield' boundary.</code></pre>
        <p><code>buffer</code> is used <em>after</em> the <code>await</code>, so the compiler would
        have to store it in the state machine — a heap object. A <code>ref struct</code> cannot live
        on the heap.</p>
        <p><strong>The fix is a <code>Memory&lt;byte&gt;</code> for the part that crosses the await,
        and a <code>Span</code> taken inside the synchronous stretch:</strong></p>
        <pre data-lang="csharp" data-net="10"><code>public async Task&lt;int&gt; CountDigitsAsync(Stream source, CancellationToken ct)
{
    byte[] rented = System.Buffers.ArrayPool&lt;byte&gt;.Shared.Rent(256);
    try
    {
        Memory&lt;byte&gt; buffer = rented.AsMemory(0, 256);

        // Memory crosses the await without complaint.
        int read = await source.ReadAsync(buffer, ct);

        // Take the Span AFTER the await, for the synchronous work only.
        ReadOnlySpan&lt;byte&gt; span = buffer.Span[..read];

        int digits = 0;
        foreach (byte b in span)
        {
            if (b &gt;= (byte)'0' &amp;&amp; b &lt;= (byte)'9')
            {
                digits++;
            }
        }

        return digits;
    }
    finally
    {
        System.Buffers.ArrayPool&lt;byte&gt;.Shared.Return(rented);
    }
}</code></pre>
        <p>Note the original also had a second bug worth spotting: it allocated
        <code>new byte[256]</code> for the read and then counted digits in <code>buffer</code>, which
        was never written to. It would have returned 0.</p>
        <p><strong>What would NOT have fixed it:</strong> making the method synchronous, or moving the
        span declaration. The rule is about crossing the boundary — a span used entirely before the
        await compiles fine.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Rewrite this to allocate nothing per line, and say what you had to check before you could.</p>
    <pre data-lang="csharp" data-net="10"><code>public static decimal TotalGbp(IEnumerable&lt;string&gt; lines)
{
    decimal total = 0m;

    foreach (string line in lines)
    {
        string[] fields = line.Split(',');
        if (fields[1] == "GBP")
        {
            total += decimal.Parse(fields[2], CultureInfo.InvariantCulture);
        }
    }

    return total;
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>What to check first:</strong> that <code>decimal.Parse</code> has a
        <code>ReadOnlySpan&lt;char&gt;</code> overload. It does — every numeric type in .NET does. If
        it did not, the field would have to become a string again and the rewrite would save
        nothing.</p>
        <pre data-lang="csharp" data-net="10"><code>public static decimal TotalGbp(IEnumerable&lt;string&gt; lines)
{
    decimal total = 0m;

    foreach (string line in lines)
    {
        ReadOnlySpan&lt;char&gt; span = line;

        int first = span.IndexOf(',');
        if (first &lt; 0)
        {
            continue;
        }

        ReadOnlySpan&lt;char&gt; rest = span[(first + 1)..];
        int second = rest.IndexOf(',');
        if (second &lt; 0)
        {
            continue;
        }

        ReadOnlySpan&lt;char&gt; currency = rest[..second];

        // SequenceEqual compares content without allocating either side.
        if (!currency.SequenceEqual("GBP"))
        {
            continue;
        }

        ReadOnlySpan&lt;char&gt; amountField = rest[(second + 1)..];
        int third = amountField.IndexOf(',');
        if (third &gt;= 0)
        {
            amountField = amountField[..third];
        }

        total += decimal.Parse(amountField, CultureInfo.InvariantCulture);
    }

    return total;
}</code></pre>
        <p>Measured on the equivalent comparison, 200,000 lines:</p>
        <pre data-lang="console"><code>   version           allocated      per line     time
   string.Split    59,201,024 B       296 B       55 ms
   span walk              672 B         0 B        8 ms</code></pre>
        <p><strong>Three things worth noting.</strong></p>
        <ul>
          <li><code>currency == "GBP"</code> does not compile on a span; use
          <code>SequenceEqual</code>. That is a feature — the comparison you want is explicit rather
          than an accidental reference comparison.</li>
          <li>The rewrite is materially harder to read. That is the real cost, and it is why this
          belongs on a measured hot path rather than everywhere.</li>
          <li>.NET 8's <code>MemoryExtensions.Split</code> filling a
          <code>Span&lt;Range&gt;</code> is tidier when the field count is known and small.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>This code passes every test and corrupts data in production under load. Find both bugs.</p>
    <pre data-lang="csharp" data-net="10"><code>public sealed class StatementFormatter
{
    public Memory&lt;char&gt; Format(Statement statement)
    {
        char[] buffer = ArrayPool&lt;char&gt;.Shared.Rent(256);
        int written = WriteInto(statement, buffer);
        ArrayPool&lt;char&gt;.Shared.Return(buffer);
        return buffer.AsMemory(0, written);
    }

    public string Render(Statement statement)
    {
        char[] buffer = ArrayPool&lt;char&gt;.Shared.Rent(256);
        try
        {
            WriteInto(statement, buffer);
            return new string(buffer);
        }
        finally
        {
            ArrayPool&lt;char&gt;.Shared.Return(buffer);
        }
    }

    private static int WriteInto(Statement statement, Span&lt;char&gt; destination) =&gt; 0;
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Bug 1, in <code>Format</code>: a view returned over a buffer that has been given
        back.</strong> The <code>Memory&lt;char&gt;</code> points at pooled memory the caller does not
        own. The next tenant to rent that buffer overwrites it. Reproduced exactly:</p>
        <pre data-lang="console"><code>   what the caller was given : "CUSTOMER-000512 GBP 1234.50"
   after another tenant rents: "ATTACKER-999 USD 0.01XXXXXX"</code></pre>
        <p><strong>Bug 2, in <code>Render</code>: <code>new string(buffer)</code> uses the whole
        rented array, not the part that was written.</strong> <code>Rent(256)</code> returns an array
        of <em>at least</em> 256 — rounded up to a power of two — so the returned string contains
        every leftover character from the previous tenant.</p>
        <p>Both are data-disclosure bugs, both pass a single-threaded test where the pool hands back a
        clean buffer, and both fail under load when the pool is actually being shared.</p>
        <pre data-lang="csharp" data-net="10"><code>public sealed class StatementFormatter
{
    // Option 1: the caller supplies the buffer, so nothing can outlive it.
    public bool TryFormat(Statement statement, Span&lt;char&gt; destination, out int charsWritten)
    {
        charsWritten = 0;

        if (destination.Length &lt; 256)
        {
            return false;
        }

        charsWritten = WriteInto(statement, destination);
        return true;
    }

    // Option 2: hand over ownership explicitly, so disposal is the caller's.
    public IMemoryOwner&lt;char&gt; Format(Statement statement, out int length)
    {
        IMemoryOwner&lt;char&gt; owner = MemoryPool&lt;char&gt;.Shared.Rent(256);
        length = WriteInto(statement, owner.Memory.Span);
        return owner;
    }

    // Option 3: return a string, and slice to what was actually written.
    public string Render(Statement statement)
    {
        char[] buffer = ArrayPool&lt;char&gt;.Shared.Rent(256);
        try
        {
            int written = WriteInto(statement, buffer);

            // Only the part written, not buffer.Length.
            return new string(buffer, 0, written);
        }
        finally
        {
            // clearArray: true because this held one customer's statement and
            // the next tenant is a different customer.
            ArrayPool&lt;char&gt;.Shared.Return(buffer, clearArray: true);
        }
    }

    private static int WriteInto(Statement statement, Span&lt;char&gt; destination) =&gt; 0;
}</code></pre>
        <p><strong>The general rule:</strong> a pooled buffer's contents belong to whoever rented it
        <em>now</em>. Never let a view of one escape the <code>try</code>/<code>finally</code> that
        owns it, and never trust <code>.Length</code> over the count you wrote.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>A colleague proposes rewriting the entire data-access layer with spans, citing "spans are
    faster". You have the settlement-parser measurements. Write the argument you would actually make,
    for and against, and say what you would measure to settle it.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Start by correcting the premise, because it is the crux.</strong> Spans do not
        reliably make code faster. On a realistic 400,000-record parse the span version measured
        between <strong>0.91x and 1.84x</strong> the original across runs — sometimes slower. What it
        did do, deterministically, is take allocation from 184 bytes per record to 0.</p>
        <pre data-lang="console"><code>   version        time        allocated       per record   gen0   gen2
   Substring         281 ms     73,603,512 B       184 B     22      0
   Span              220 ms            376 B         0 B      0      0</code></pre>
        <p><strong>The case FOR, where it applies:</strong></p>
        <ul>
          <li>Allocation reduction is real, deterministic and testable. It removed 22 gen 0
          collections from the parse.</li>
          <li>In a shared process, allocation is not a local cost. Ledger's importer was causing a
          health endpoint on the same pod to time out.</li>
          <li>It composes: the BCL's span overloads mean the rewrite usually does not spread.</li>
        </ul>
        <p><strong>The case AGAINST a blanket rewrite:</strong></p>
        <ul>
          <li><strong>The data-access layer is the wrong target.</strong> It is dominated by network
          and disk latency. Removing 184 bytes of allocation from an operation that waits 8 ms for a
          database is measuring the wrong thing entirely.</li>
          <li>Results that must become strings anyway — entity properties, DTO fields, dictionary
          keys — save nothing. Measured: identical allocation.</li>
          <li>Spans cannot cross an <code>await</code>, and a data-access layer is almost entirely
          async. The rewrite forces <code>Memory&lt;T&gt;</code>, which removes the compiler's
          lifetime checking and introduces the use-after-return bug class.</li>
          <li>It is harder to read, and unusable with LINQ.</li>
        </ul>
        <p><strong>What to measure to settle it, in order:</strong></p>
        <ol>
          <li><strong>Allocation per operation</strong> with two
          <code>GC.GetTotalAllocatedBytes</code> calls. Three lines, no profiler, deterministic
          number.</li>
          <li><strong>Percentage of time in GC</strong> from <code>dotnet-counters</code>. Below about
          5% there is no problem to solve, whatever the allocation rate.</li>
          <li><strong>Allocation by type</strong> from a <code>gc-verbose</code> trace, to find where
          it actually is rather than where it is assumed to be.</li>
        </ol>
        <p><strong>The recommendation:</strong> measure first, then rewrite the two or three hot
        parsing paths the trace identifies, with an allocation regression test on each. Not the
        layer.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Write a zero-allocation reader that parses a UTF-8 settlement record arriving as
    <code>ReadOnlySpan&lt;byte&gt;</code> into a struct, validating as it goes. Then explain why the
    return type is what it is.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10"><code>using System.Buffers.Text;

public readonly record struct SettlementRecord(
    long AmountMinor,
    Currency Currency,
    DateOnly ValueDate);

public enum Currency
{
    Unknown = 0,
    Gbp,
    Eur,
    Usd
}

public static class SettlementReader
{
    // 16 invoice, 3 currency, 13 amount, 10 date
    private const int RecordLength = 42;

    // u8 literals: UTF-8 bytes baked in at compile time, no allocation and
    // no encoding step at comparison time.
    private static ReadOnlySpan&lt;byte&gt; Gbp =&gt; "GBP"u8;
    private static ReadOnlySpan&lt;byte&gt; Eur =&gt; "EUR"u8;
    private static ReadOnlySpan&lt;byte&gt; Usd =&gt; "USD"u8;

    public static bool TryRead(ReadOnlySpan&lt;byte&gt; record, out SettlementRecord result)
    {
        result = default;

        if (record.Length &lt; RecordLength)
        {
            return false;
        }

        Currency currency = ReadCurrency(record.Slice(16, 3));
        if (currency == Currency.Unknown)
        {
            return false;
        }

        // Utf8Parser reads the number straight out of the bytes.
        if (!Utf8Parser.TryParse(record.Slice(19, 13), out long amountMinor, out int consumed)
            || consumed == 0)
        {
            return false;
        }

        if (!TryReadIsoDate(record.Slice(32, 10), out DateOnly valueDate))
        {
            return false;
        }

        result = new SettlementRecord(amountMinor, currency, valueDate);
        return true;
    }

    private static Currency ReadCurrency(ReadOnlySpan&lt;byte&gt; field)
    {
        if (field.SequenceEqual(Gbp))
        {
            return Currency.Gbp;
        }

        if (field.SequenceEqual(Eur))
        {
            return Currency.Eur;
        }

        if (field.SequenceEqual(Usd))
        {
            return Currency.Usd;
        }

        return Currency.Unknown;
    }

    private static bool TryReadIsoDate(ReadOnlySpan&lt;byte&gt; field, out DateOnly date)
    {
        date = default;

        // Validate the shape before trusting the digits.
        if (field[4] != (byte)'-' || field[7] != (byte)'-')
        {
            return false;
        }

        foreach (int index in stackalloc int[] { 0, 1, 2, 3, 5, 6, 8, 9 })
        {
            if (field[index] &lt; (byte)'0' || field[index] &gt; (byte)'9')
            {
                return false;
            }
        }

        int year = (field[0] - '0') * 1000 + (field[1] - '0') * 100
                 + (field[2] - '0') * 10 + (field[3] - '0');
        int month = (field[5] - '0') * 10 + (field[6] - '0');
        int day = (field[8] - '0') * 10 + (field[9] - '0');

        if (month is &lt; 1 or &gt; 12 || day &lt; 1 || day &gt; DateTime.DaysInMonth(year, month))
        {
            return false;
        }

        date = new DateOnly(year, month, day);
        return true;
    }
}</code></pre>
        <p><strong>Why the return type is <code>bool</code> with an <code>out</code> struct, and not
        the alternatives:</strong></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Alternative</th><th>Why not</th></tr></thead>
            <tbody>
              <tr><td><code>SettlementRecord?</code></td><td><code>Nullable&lt;T&gt;</code> of a struct is fine, but the <code>Try</code> convention matches the BCL and reads better at the call site.</td></tr>
              <tr><td>A <code>class</code> rather than a <code>record struct</code></td><td>Allocates one object per record — 400,000 per file, which is the cost being removed.</td></tr>
              <tr><td>Throwing on malformed input</td><td>A settlement file has malformed lines routinely. Exceptions for expected outcomes are expensive and force a try/catch in the hot loop.</td></tr>
              <tr><td>Returning <code>ReadOnlySpan&lt;byte&gt;</code> fields in the struct</td><td>A struct with span fields must itself be a <code>ref struct</code>, which then cannot be stored in a list, returned from async, or put in a collection. It also keeps the whole input buffer alive.</td></tr>
              <tr><td>Returning <code>string</code> fields</td><td>Reintroduces the allocation. The currency becomes an <code>enum</code> precisely to avoid it.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The design rule underneath all of it:</strong> spans are for the <em>parsing</em>,
        not for the <em>result</em>. Convert to owned values — numbers, enums, dates — at the boundary,
        and the span never escapes the method that read it. That is what makes this safe as well as
        allocation-free.</p>
        <p>Measured on the equivalent parser, 400,000 records: <strong>15 ms and 0 bytes per
        record</strong>, against 281 ms and 184 bytes for the <code>Substring</code> version.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is a <code>Span&lt;T&gt;</code>, structurally?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Two fields — a reference to the first element and a length —
        living on the stack. It is a view over memory somebody else owns, not a copy. Writing through
        it writes the original.</p></div>
      </details></li>

    <li><p>Do spans make code faster?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>They make it allocate less, which is not the same thing. Measured
        on a 400,000-record parse, the time ranged from 0.91x to 1.84x across runs — sometimes slower.
        Allocation went from 184 bytes per record to 0, every run.</p>
        <p>Argue for a span rewrite on allocation and GC pressure, not on the clock.</p></div>
      </details></li>

    <li><p>Why can a <code>Span&lt;T&gt;</code> not be a field of a class?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The class lives on the heap and could outlive whatever the span
        points at — most dangerously a stack frame that has returned. <code>CS8345</code>. Every other
        ref struct restriction follows from the same reasoning.</p></div>
      </details></li>

    <li><p>Can you use a <code>Span&lt;T&gt;</code> inside an <code>async</code> method?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Yes, as long as it is not <em>preserved across</em> an
        <code>await</code>. <code>CS4007</code> says exactly that. A span created and finished with
        before the await compiles fine.</p>
        <p>The pattern for async code is <code>Memory&lt;T&gt;</code> across the awaits, taking
        <code>.Span</code> inside each synchronous stretch.</p></div>
      </details></li>

    <li><p>What does <code>Memory&lt;T&gt;</code> give up in exchange for crossing an await?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The compiler's guarantee that the view cannot outlive its target.
        Nothing stops you holding a <code>Memory&lt;T&gt;</code> over a pooled buffer after returning
        it — measured, one customer's record became another's, on every run.</p></div>
      </details></li>

    <li><p>What is the difference between <code>array[..100]</code> and
      <code>array.AsSpan()[..100]</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The first copies 100 elements — measured at 424 bytes per call.
        The second slices and allocates nothing. Range syntax on an array calls
        <code>GetSubArray</code>; on a span it adjusts a reference and a length.</p></div>
      </details></li>

    <li><p>Give the two rules for <code>stackalloc</code>.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Never with a size derived from input, and never inside a loop.
        The allocation is released when the <em>method</em> returns, not at the end of an iteration,
        and a stack overflow cannot be caught — no exception, no <code>finally</code>, no logging.</p>
        <p>The safe shape is a constant stack size with an <code>ArrayPool</code> fallback above it.</p></div>
      </details></li>

    <li><p>Why use <code>CopyTo</code> rather than a copy loop between two slices?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Slices of one buffer can overlap. <code>CopyTo</code> detects
        that and copies in the safe direction; a forward loop reads values it has already overwritten.
        Measured: <code>[1, 1, 2, 3, 5, 6]</code> against <code>[1, 1, 1, 1, 5, 6]</code> for the same
        intent.</p></div>
      </details></li>

    <li><p>Name three situations where a span rewrite is not worth doing.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The value has to become a string anyway (measured: identical
        allocation); the API you need has no span overload, so you convert back and lose the saving;
        and the code is not hot, where you have only made it harder to read and unusable in async and
        LINQ.</p></div>
      </details></li>

    <li><p>What is the single most useful thing to measure when deciding whether to rewrite with
      spans?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Bytes allocated per operation, from two calls to
        <code>GC.GetTotalAllocatedBytes(precise: true)</code>. It needs no profiler, it is
        deterministic, and it can be asserted in a test — unlike the timing, which varied by a factor
        of two across runs of identical code.</p>
        <p>Then check percentage of time in GC. Below about 5% there is no problem to solve.</p></div>
      </details></li>
  </ol>
</section>
`
});
