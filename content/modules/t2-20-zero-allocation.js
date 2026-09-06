CSPREP.module({
  id: "t2-20-zero-allocation",
  minutes: 55,
  updated: "2026-09-02",
  summary: "One formatting method rewritten five times, measuring each step. Allocation fell monotonically 188 to 169 to 83 to 0 bytes per call - and time did not: the pooled version allocates NOTHING and is slower than the version allocating 83 bytes, on every run, because renting a 64-byte buffer costs more than allocating one. Zero allocation is not the same as fast. Also the allocations nobody writes on purpose: a captured local at 88 bytes, an interface-typed foreach at 40, and a rented buffer that hands one customer another customer's balance.",
  terms: ["allocation", "ArrayPool", "MemoryPool", "object pool", "rent", "return",
    "bucket", "clearArray", "double return", "stackalloc", "SearchValues", "string.Create",
    "struct enumerator", "closure", "display class", "boxing", "params array",
    "async state machine", "pooling threshold", "allocation regression test"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger's payment API had a latency graph with a sawtooth in it. The p99 climbed steadily for
  about four seconds, dropped sharply, and started climbing again. The period matched generation 0
  collections exactly.</p>

  <p>Nothing was leaking. Memory was flat. The service was allocating 675 bytes per request to produce
  a 90-byte response, and at 5,000 requests per second that is 3.2 MB every second passing through the
  collector — 11.4 GB an hour.</p>

  <p>The handler contained no <code>new</code> keyword at all. Every one of those bytes came from
  something that does not look like an allocation:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   what                                  per call
   ----                                  --------
   closure capturing a local               88 B
   static lambda, nothing captured          0 B
   boxing into params object[]             88 B
   the generic overload instead             0 B
   enumerating through IEnumerable         40 B
   enumerating the concrete type            0 B
   params array                           120 B
   async Task&lt;int&gt;, small result            0 B
   async Task&lt;int&gt;, result over 8          72 B
   the same, returning ValueTask            0 B</code></pre>

  <p>Look at the enumerator pair. <strong>The same loop over the same list</strong> allocates 40 bytes
  or nothing, decided entirely by whether the variable is typed <code>List&lt;int&gt;</code> or
  <code>IEnumerable&lt;int&gt;</code>.</p>

  <p>This module is about finding those, and about the more important question of when to stop. The
  central measurement is one method rewritten five times, and it does not say what you would expect:</p>

  <pre data-lang="console" data-title="03-hot-path.cs"><code>   version                          allocated    per op     gen0     time
   v1 interpolation + LINQ          93,278,392 B      187 B     29      512 ms
   v2 StringBuilder, reused         84,536,376 B      169 B     26      192 ms
   v3 string.Create + spans         41,512,376 B       83 B     13      175 ms
   v4 UTF-8 into a pooled buffer          800 B        0 B      0      292 ms
   v5 UTF-8 into stackalloc               712 B        0 B      0      198 ms</code></pre>

  <p><strong>Version 4 allocates nothing and is slower than version 3, which allocates 83 bytes per
  call.</strong> That happened on every run. Zero allocation is not the same as fast, and a pool
  applied to the wrong size is a pessimisation wearing an optimisation's clothes.</p>
</section>

<section id="plain-language">
  <h2>What allocation costs, and what it does not</h2>

  <p class="define"><span class="define__term">Allocate</span> To obtain memory for a new object. In
  .NET this is close to free at the moment it happens: the runtime holds a pointer to the next free
  byte on the current thread's allocation region and moves it along.</p>

  <p class="define"><span class="define__term">Generation 0</span> The youngest age band of the heap.
  New small objects start here, and it is collected often and cheaply — a collection here examines
  only what survived, which for a healthy workload is almost nothing.</p>

  <p class="define"><span class="define__term">Allocation pressure</span> The rate at which your code
  fills generation 0, which determines how often the collector runs. Not to be confused with how much
  survives, which determines how much each run costs.</p>

  <p>So allocating is cheap and collecting young objects is cheap. Why does any of this matter?</p>

  <p><strong>Because the cost is not paid by the code that causes it.</strong> A generation 0
  collection suspends every thread in the process. The handler that allocated 675 bytes finished long
  ago; the pause lands on whichever request happens to be in flight when the budget runs out. That is
  the sawtooth.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>At 5,000 requests per second and 675 bytes each, Ledger fills a typical generation 0 budget
    every few seconds. Every one of those collections is a pause taken by an unlucky request that did
    nothing wrong.</p>
    <p>Reducing to 216 bytes per request took the allocation rate from 11.4 GB/hour to 3.6 GB/hour and
    the collections from 43 to 13 over the same workload. The p99 sawtooth flattened. <strong>No
    single request got faster</strong> — the distribution stopped having a tail.</p>
  </div>

  <p><strong>An analogy, and its limits.</strong> Think of a shared kitchen. Using a plate is quick.
  Washing up happens when the sink is full, and whoever is in the kitchen at that moment has to wait,
  whether or not they used any plates. Using fewer plates does not make your cooking faster; it makes
  the interruptions rarer for everybody.</p>

  <p><strong>Where the analogy breaks:</strong> in a kitchen the washing-up scales with the plates
  used. Generation 0 collection cost scales with what <em>survives</em>, not with what was allocated —
  so a workload that allocates enormously and keeps nothing can be perfectly healthy. Allocation rate
  tells you how often; survival tells you how much.</p>

  <h3>The order to work in</h3>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Step</th><th>Effort</th><th>Reviewable?</th></tr>
      </thead>
      <tbody>
        <tr><td>Remove accidental allocations (closures, boxing, <code>Split</code>, interface enumeration)</td><td>Low</td><td>Yes, line by line</td></tr>
        <tr><td>Build strings once at the right size (<code>string.Create</code>)</td><td>Medium</td><td>Yes</td></tr>
        <tr><td>Use spans instead of substrings</td><td>Medium</td><td>Mostly</td></tr>
        <tr><td>Pool buffers above about a kilobyte</td><td>Medium</td><td>Needs care — see the bugs below</td></tr>
        <tr><td>Stop producing objects at all (span-taking APIs)</td><td>High</td><td>Changes callers</td></tr>
      </tbody>
    </table>
  </div>

  <p>Most services should do the first two and stop. The rest of this module is about how to tell
  whether you are one of the exceptions, and how not to hurt yourself if you are.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — Zero allocation is not the same as fast, and a pool
// applied to the wrong size makes things worse.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Buffers;
using System.Diagnostics;

const int Iterations = 500_000;

Console.WriteLine("Filling a 64-byte buffer, three ways:");
Console.WriteLine();
Console.WriteLine("   strategy            allocated    per call    time");
Console.WriteLine("   --------            ---------    --------    ----");

Measure("new byte[64]     ", static () =&gt;
{
    var buffer = new byte[64];
    buffer[0] = 1;
    return buffer[0];
});

Measure("ArrayPool rent   ", static () =&gt;
{
    byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(64);
    buffer[0] = 1;
    byte result = buffer[0];
    ArrayPool&lt;byte&gt;.Shared.Return(buffer);
    return result;
});

Measure("stackalloc       ", static () =&gt;
{
    Span&lt;byte&gt; buffer = stackalloc byte[64];
    buffer[0] = 1;
    return buffer[0];
});

Console.WriteLine();
Console.WriteLine("The pool allocates nothing and is the SLOWEST of the three, on every");
Console.WriteLine("run. Rent and Return do more bookkeeping than a 64-byte allocation");
Console.WriteLine("costs, and a gen 0 allocation is close to a pointer bump.");
Console.WriteLine();
Console.WriteLine("stackalloc allocates nothing and matches the plain allocation on time -");
Console.WriteLine("it is not dramatically faster, and this file does not claim it is. What");
Console.WriteLine("it removes is 88 bytes per call of pressure on the collector, which is");
Console.WriteLine("paid by whatever else is running in the process.");
Console.WriteLine();
Console.WriteLine("The lesson is the middle row: zero allocation is not the same as fast.");

static void Measure(string label, Func&lt;byte&gt; body)
{
    for (int i = 0; i &lt; 10_000; i++)
    {
        body();
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    long sink = 0;
    for (int i = 0; i &lt; Iterations; i++)
    {
        sink += body();
    }

    sw.Stop();
    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine($"   {label}   {allocated,10:N0} B   {allocated / (double)Iterations,6:F0} B   " +
        $"{sw.Elapsed.TotalMilliseconds,5:F0} ms   (sink {sink})");
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Filling a 64-byte buffer, three ways:

   strategy            allocated    per call    time
   --------            ---------    --------    ----
   new byte[64]        44,000,000 B       88 B       7 ms
   ArrayPool rent             848 B        0 B      18 ms
   stackalloc                 672 B        0 B       7 ms</code></pre>

  <p>Three results worth separating.</p>

  <p><strong>The pool allocates nothing and is the slowest</strong>, on every run.
  <code>Rent</code> and <code>Return</code> do more bookkeeping than a 64-byte allocation costs.</p>

  <p><strong><code>stackalloc</code> allocates nothing and matches the plain allocation on time.</strong>
  It is not dramatically faster and this module does not claim it is. What it removes is 88 bytes per
  call of pressure on a collector shared with everything else in the process.</p>

  <p><strong>The middle row is the lesson.</strong> Zero allocation is not the same as fast.</p>
</section>

<section id="pooling">
  <h2>Pooling, and the three bugs it brings</h2>

  <p class="define"><span class="define__term">ArrayPool&lt;T&gt;</span> A cache of arrays you borrow
  and give back rather than allocating each time. <code>ArrayPool&lt;T&gt;.Shared</code> is a
  process-wide instance; <code>ArrayPool&lt;T&gt;.Create</code> makes a private one.</p>

  <p class="define"><span class="define__term">Rent</span> Borrow an array of <em>at least</em> the
  requested length. Not exactly — the pool keeps arrays in power-of-two buckets.</p>

  <p class="define"><span class="define__term">Return</span> Give the array back. Optional in the
  sense that nothing breaks if you forget, and essential in the sense that forgetting removes the
  entire benefit.</p>

  <h3>What Rent actually gives you</h3>

  <pre data-lang="console" data-title="01-pooling.cs"><code>   requested   Length given   wasted
   ---------   ------------   ------
           1             16       15
          10             16        6
         100            128       28
       1,000          1,024       24
       5,000          8,192    3,192
     100,000        131,072   31,072</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Every use of <code>rented.Length</code> instead of the count you asked for, or the count you
    wrote, is a bug. It is the most common mistake with this API, and the consequence is not a wrong
    number — it is <strong>another user's data in this user's response</strong>.</p>
  </div>

  <h3>Bug 1: the buffer arrives dirty</h3>

  <pre data-lang="console" data-title="01-pooling.cs"><code>   tenant two wrote  : "OK" (2 chars)
   new string(buffer): "OKSTOMER-000512 GBP 1234.50"
   new string(buf,0,n): "OK"</code></pre>

  <p>Read the middle line. Tenant two wrote two characters and read the whole array, and got the
  previous tenant's customer record with its first two characters overwritten. If that string goes
  into an HTTP response, one customer has been shown another customer's data.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Two bugs in one line"><code>byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(length);
try
{
    // Bug 1: Read returns how many bytes it actually read. Ignoring it
    // means the tail of the buffer is stale.
    stream.Read(buffer);

    // Bug 2: buffer.Length is not 'length' - Rent rounds up. This reads
    // whatever the previous tenant left behind.
    return Encoding.UTF8.GetString(buffer);
}
finally
{
    ArrayPool&lt;byte&gt;.Shared.Return(buffer);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Track what you wrote, and clear on return"><code>byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(length);
try
{
    // ReadExactly throws if the stream ends early, rather than silently
    // leaving part of the buffer stale. CA2022 flags the Read version.
    stream.ReadExactly(buffer.AsSpan(0, length));

    return Encoding.UTF8.GetString(buffer.AsSpan(0, length));
}
finally
{
    // clearArray: true costs a memset and guarantees the next tenant
    // cannot read this request's data.
    ArrayPool&lt;byte&gt;.Shared.Return(buffer, clearArray: true);
}</code></pre>

  <h3>Bug 2: returning twice</h3>

  <pre data-lang="console" data-title="01-pooling.cs"><code>   two independent renters got the SAME array: True
   renter A wrote 111, then renter B wrote 222
   renter A now reads: 222</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>This is the worst bug in the module. Two unrelated parts of the program are silently sharing
    one buffer, and renter A's data was overwritten by code it has never heard of. No exception, no
    warning, and it reproduces deterministically.</p>
    <p>It happens when a <code>finally</code> returns a buffer an inner method has already returned,
    or when a <code>Dispose</code> runs twice.</p>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="Null the field as you return it"><code>public sealed class PooledBuffer : IDisposable
{
    private byte[]? _buffer;

    public PooledBuffer(int minimumLength)
    {
        _buffer = ArrayPool&lt;byte&gt;.Shared.Rent(minimumLength);
        Length = minimumLength;
    }

    public int Length { get; }

    public Span&lt;byte&gt; Span =&gt;
        (_buffer ?? throw new ObjectDisposedException(nameof(PooledBuffer))).AsSpan(0, Length);

    public void Dispose()
    {
        // Exchange, so a second Dispose finds null and returns nothing.
        // This is what makes double-return impossible rather than unlikely.
        byte[]? buffer = Interlocked.Exchange(ref _buffer, null);
        if (buffer is not null)
        {
            ArrayPool&lt;byte&gt;.Shared.Return(buffer, clearArray: true);
        }
    }
}</code></pre>

  <h3>Bug 3: forgetting to return</h3>

  <pre data-lang="console" data-title="01-pooling.cs"><code>   20,000 rents of 8,192 bytes
     returning properly :      0.0 MB allocated
     never returning    :    156.7 MB allocated</code></pre>

  <p>Not returning is not a memory leak — the pool holds no reference to an array it never got back,
  so the collector reclaims it normally. It is worse in a subtler way: <strong>the code looks like it
  is pooling, the reviewer believes it is pooling, and it allocates on every call.</strong> A pool
  with no returns is a slower <code>new byte[]</code> with extra ceremony.</p>

  <h3>When pooling actually pays</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   size        new byte[]    ArrayPool    pool wins?
   ----        ----------    ---------    ----------
          32          2 ms          4 ms    NO (0.62x)
         128          3 ms          4 ms    NO (0.68x)
       1,024          7 ms          4 ms    yes (1.8x)
       8,192         48 ms          4 ms    yes (12.0x)
      65,536        279 ms          6 ms    yes (47.2x)
   1,000,000       3585 ms          2 ms    yes (1656.0x)</code></pre>

  <p>The crossover is around a kilobyte on this machine. Below it, pooling loses — a generation 0
  allocation is close to a pointer bump, and <code>Rent</code>/<code>Return</code> is real
  bookkeeping.</p>

  <p>Above 85,000 bytes the array lands on the large object heap, where a plain allocation is
  dramatically worse, which is why the ratio explodes at the bottom of that table.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>A rule that follows directly: <strong>below about a kilobyte, use <code>stackalloc</code> if
    the size is constant and a plain array otherwise. Pool the sizes that would reach the large object
    heap.</strong></p>
    <p>Between those, measure. The crossover depends on your hardware and on how much work you do per
    buffer.</p>
  </div>

  <h3>Pooling an object rather than an array</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-exercises.cs"><code>sealed class SimplePool&lt;T&gt; where T : class
{
    private readonly Func&lt;T&gt; _create;
    private readonly Action&lt;T&gt; _reset;
    private readonly T?[] _items;

    public SimplePool(Func&lt;T&gt; create, Action&lt;T&gt; reset, int maxRetained)
    {
        _create = create;
        _reset = reset;
        _items = new T?[maxRetained];
    }

    public T Rent()
    {
        for (int i = 0; i &lt; _items.Length; i++)
        {
            T? item = Interlocked.Exchange(ref _items[i], null);
            if (item is not null)
            {
                return item;
            }
        }

        // Empty pool: create rather than block. Renting must always succeed.
        return _create();
    }

    public void Return(T item)
    {
        // Reset on return, so the pool never holds live data while idle.
        _reset(item);

        for (int i = 0; i &lt; _items.Length; i++)
        {
            if (Interlocked.CompareExchange(ref _items[i], item, null) is null)
            {
                return;
            }
        }</code></pre>

  <p>Three things this gets right that a naive pool does not:</p>

  <ol>
    <li><strong>It is bounded.</strong> An unbounded pool is a memory leak with a respectable name —
    it retains every object ever returned. The line that drops an object when the pool is full is the
    one usually left out.</li>
    <li><strong>Rent always succeeds.</strong> An empty pool creates rather than blocking or
    failing.</li>
    <li><strong>The reset runs on return</strong>, so the pool never holds live data while idle. That
    matters if a memory dump is taken.</li>
  </ol>

  <p>In a real service use <code>Microsoft.Extensions.ObjectPool</code>. The point of writing one out
  is that the interesting part is the <em>reset policy</em>, which no library can choose for you.</p>
</section>

<section id="searchvalues">
  <h2><code>SearchValues</code>, and the allocation hiding in <code>IndexOfAny</code></h2>

  <p class="define"><span class="define__term">SearchValues&lt;T&gt;</span> A precomputed set of
  values to search for, built once and reused. Construction analyses the set and picks an algorithm —
  for a small ASCII set, a bitmap scanned with vector instructions.</p>

  <pre data-lang="console" data-title="02-searchvalues.cs"><code>   200,000 calls with an explicit array:
     allocated : 7,120,264 bytes (36 per call)</code></pre>

  <p>That is <code>text.IndexOfAny(new[] { ';', ',', ':' })</code>. The overload takes
  <code>params char[]</code>, and written inline the array is allocated every call.</p>

  <pre data-lang="console" data-title="02-searchvalues.cs"><code>   approach                        allocated       time      index
   --------                        ---------       ----      -----
   SearchValues.IndexOfAny              376 B       27 ms      16
   span.IndexOfAny(a, b, c)             376 B       40 ms      16
   string.IndexOfAny(char[])            376 B       33 ms      16
   hand-written HashSet loop            464 B      280 ms      16</code></pre>

  <p>All four find the same index — the first thing to check in any comparison like this. The array
  overloads allocate nothing <em>here</em> only because the array was hoisted into a local outside the
  loop.</p>

  <pre data-lang="csharp" data-net="10" data-title="How to declare one"><code>public static class SettlementParser
{
    // static readonly: built ONCE for the lifetime of the process.
    // Construction is the expensive part, so this must not be a local.
    private static readonly SearchValues&lt;char&gt; Delimiters = SearchValues.Create(";,:");
    private static readonly SearchValues&lt;char&gt; Digits = SearchValues.Create("0123456789");

    // The UTF-8 equivalent, for data that arrives as bytes.
    private static readonly SearchValues&lt;byte&gt; Utf8Delimiters = SearchValues.Create(";,:"u8);

    public static int FindDelimiter(ReadOnlySpan&lt;char&gt; line) =&gt; line.IndexOfAny(Delimiters);

    public static bool IsAllDigits(ReadOnlySpan&lt;char&gt; field) =&gt;
        !field.IsEmpty &amp;&amp; field.IndexOfAnyExcept(Digits) &lt; 0;

    public static int FindUtf8Delimiter(ReadOnlySpan&lt;byte&gt; line) =&gt; line.IndexOfAny(Utf8Delimiters);
}</code></pre>

  <p><code>IndexOfAnyExcept</code> is the validation primitive: "is every character in this set",
  without a loop and without allocating. Note the empty-string case needs handling separately — a span
  with nothing in it has nothing outside the set either.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>SearchValues</code> is for <strong>three or more values searched for repeatedly</strong>.
    For a single character, plain <code>IndexOf</code> is already vectorised and
    <code>SearchValues</code> adds an indirection for nothing — measured at 15 ms against 39 ms.</p>
    <p>And creating one inside the method you call in a loop is strictly worse than not using it at
    all, because construction is the expensive part. It must be a <code>static readonly</code>
    field.</p>
  </div>
</section>

<section id="the-rewrite">
  <h2>One method, five versions</h2>

  <p>The job: build an audit line for a payment and hand it to a sink. Ledger does this once per
  payment, 5,000 times a second.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="v1 - what the code looked like"><code>static long V1(Payment payment, Sink sink)
{
    string[] flags = payment.Flags.Split(',');
    string status = flags.Any(f =&gt; f == "held") ? "HELD" : "OK";

    string line = $"PAY-{payment.Id:D10} {payment.Currency} " +
                  $"{payment.AmountMinor / 100m:F2} {status}";

    return sink.Accept(line);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="v3 - string.Create at exactly the right length"><code>static long V3(Payment payment, Sink sink)
{
    bool held = ContainsFlag(payment.Flags, "held");
    string status = held ? "HELD" : "OK";

    // 4 + 10 + 1 + 3 + 1 + up to 18 + 1 + 4
    int length = 4 + 10 + 1 + payment.Currency.Length + 1 + AmountLength(payment.AmountMinor)
               + 1 + status.Length;

    string line = string.Create(length, (payment, status), static (destination, state) =&gt;
    {
        (Payment p, string s) = state;
        int position = 0;

        "PAY-".AsSpan().CopyTo(destination);
        position += 4;

        p.Id.TryFormat(destination[position..], out int written, "D10", CultureInfo.InvariantCulture);
        position += written;

        destination[position++] = ' ';
        p.Currency.AsSpan().CopyTo(destination[position..]);
        position += p.Currency.Length;

        destination[position++] = ' ';
        (p.AmountMinor / 100m).TryFormat(destination[position..], out written, "F2", CultureInfo.InvariantCulture);
        position += written;

        destination[position++] = ' ';
        s.AsSpan().CopyTo(destination[position..]);
    });

    return sink.Accept(line);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="v5 - UTF-8 into a stack buffer"><code>static long V5(Payment payment, Sink sink)
{
    Span&lt;byte&gt; buffer = stackalloc byte[64];
    int written = FormatUtf8(payment, buffer);
    return sink.AcceptUtf8(buffer[..written]);
}

// ---------------------------------------------------------------------------</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Version</th><th>Bytes per op</th><th>gen 0</th><th>Time across runs</th></tr>
      </thead>
      <tbody>
        <tr><td>v1 interpolation + LINQ</td><td>187</td><td>29</td><td>491–618 ms</td></tr>
        <tr><td>v2 StringBuilder, reused</td><td>169</td><td>26</td><td>215–286 ms</td></tr>
        <tr><td>v3 <code>string.Create</code> + spans</td><td><strong>83</strong></td><td>13</td><td>195–262 ms</td></tr>
        <tr><td>v4 UTF-8 into a pooled buffer</td><td><strong>0</strong></td><td>0</td><td><strong>241–372 ms</strong></td></tr>
        <tr><td>v5 UTF-8 into <code>stackalloc</code></td><td><strong>0</strong></td><td>0</td><td>102–204 ms</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Read the two columns separately, because they disagree.</strong></p>

  <p>Allocation falls monotonically and deterministically: v2 through v5 print the same numbers on
  every run. Time does not fall monotonically. <strong>v4 allocates nothing and was slower than v3 on
  every run measured</strong>, because renting and returning a 64-byte buffer costs more than
  allocating one.</p>

  <h3>What each step bought</h3>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Step</th><th>What it actually did</th></tr>
      </thead>
      <tbody>
        <tr><td>v1 → v2</td><td>The biggest <strong>time</strong> win, roughly halving it — but only 19 bytes per operation. <code>Split</code> and the LINQ predicate cost mostly in work done, not bytes retained.</td></tr>
        <tr><td>v2 → v3</td><td>The biggest <strong>allocation</strong> win, 169 to 83 bytes. <code>string.Create</code> allocates the final string once at exactly the right length; <code>StringBuilder</code> allocates chunks and then copies them into a new string. Time barely moved.</td></tr>
        <tr><td>v3 → v4</td><td>Allocation to zero, and time got <strong>worse</strong>. Also changes the shape of the code: the sink now takes a span, so it must consume the bytes before the buffer is returned.</td></tr>
        <tr><td>v4 → v5</td><td>Same zero allocation, now genuinely the fastest, because the pool overhead is gone. Only safe because 64 is a compile-time constant that cannot grow with input.</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Where to stop is the real question.</strong> v2 is a two-line change any reviewer can
  check. v5 requires the caller to be restructured, and a span-taking sink cannot be used across an
  <code>await</code>.</p>

  <p>Most services should ship v2 or v3 and stop. If you go further, go to v5 rather than v4 — and
  only with a measurement showing this path is the problem.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>string.Create</code> only wins if the length is <strong>exact</strong>. An earlier version
    of the measurement guessed a length, padded, and called <code>TrimEnd</code> — which allocates a
    second string and made it <em>worse</em> than the interpolation it replaced: 168 bytes against
    112.</p>
    <p>If you cannot compute the length cheaply, <code>string.Create</code> is the wrong tool.</p>
  </div>
</section>

<section id="hidden-allocations">
  <h2>The allocations nobody writes on purpose</h2>

  <p class="define"><span class="define__term">Closure</span> The object the compiler creates to hold
  variables a lambda captures from its enclosing scope. Also called a display class. One allocation
  for the class, plus one for the delegate.</p>

  <p class="define"><span class="define__term">Boxing</span> Wrapping a value type in a heap object so
  it can be treated as <code>object</code>. Every <code>params object[]</code> argument that is an
  <code>int</code>, <code>bool</code>, <code>DateTime</code> or struct is boxed.</p>

  <p class="define"><span class="define__term">Struct enumerator</span> A <code>foreach</code> over a
  concrete type binds to its <code>GetEnumerator</code> by name. When that returns a struct, no
  allocation happens. Reaching the same collection through <code>IEnumerable&lt;T&gt;</code> forces
  the interface, which boxes it.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Allocates</th><th>Bytes</th><th>Does not</th><th>Bytes</th></tr>
      </thead>
      <tbody>
        <tr><td>Lambda capturing a local</td><td>88</td><td><code>static</code> lambda capturing nothing</td><td>0</td></tr>
        <tr><td>Boxing into <code>params object[]</code></td><td>88</td><td>A generic overload</td><td>0</td></tr>
        <tr><td><code>foreach</code> over <code>IEnumerable&lt;int&gt;</code></td><td>40</td><td><code>foreach</code> over <code>List&lt;int&gt;</code></td><td>0</td></tr>
        <tr><td><code>params int[]</code></td><td>120</td><td>Fixed overloads, or <code>ReadOnlySpan&lt;int&gt;</code></td><td>0</td></tr>
        <tr><td><code>async Task&lt;int&gt;</code> returning 1,000</td><td>72</td><td><code>ValueTask&lt;int&gt;</code></td><td>0</td></tr>
        <tr><td><code>text.Split(',')</code></td><td>120</td><td><code>span.IndexOf(',')</code> walk</td><td>0</td></tr>
        <tr><td><code>Where(...).Count()</code></td><td>96</td><td>A plain loop</td><td>0</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>An <code>async Task&lt;int&gt;</code> returning <strong>1</strong> allocates 0 bytes. The same
    method returning <strong>1,000</strong> allocates 72. The runtime caches <code>Task&lt;int&gt;</code>
    objects for results in −1 to 8.</p>
    <p>A microbenchmark that returns a small integer will tell you async is free. It is not. This is
    one of the easiest ways to measure the wrong thing.</p>
  </div>

  <h3>The struct enumerator, written out</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   yield return (iterator)        19,200,712 B      64 B/call      58 ms
   custom struct enumerator              712 B       0 B/call      53 ms</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="05-exercises.cs"><code>// A struct enumerator over comma-separated fields. No allocation, because
// foreach binds to these members by name rather than through an interface.
readonly ref struct SpanSplitter
{
    private readonly ReadOnlySpan&lt;char&gt; _text;
    private readonly char _separator;

    public SpanSplitter(ReadOnlySpan&lt;char&gt; text, char separator)
    {
        _text = text;
        _separator = separator;
    }

    public Enumerator GetEnumerator() =&gt; new Enumerator(_text, _separator);

    public ref struct Enumerator
    {
        private ReadOnlySpan&lt;char&gt; _remaining;
        private readonly char _separator;
        private bool _finished;

        public Enumerator(ReadOnlySpan&lt;char&gt; text, char separator)
        {
            _remaining = text;
            _separator = separator;
            _finished = false;
            Current = default;
        }

        public ReadOnlySpan&lt;char&gt; Current { get; private set; }

        public bool MoveNext()
        {
            if (_finished)
            {
                return false;
            }

            int index = _remaining.IndexOf(_separator);
            if (index &lt; 0)
            {
                Current = _remaining;
                _finished = true;
                return true;
            }

            Current = _remaining[..index];
            _remaining = _remaining[(index + 1)..];
            return true;
        }
    }
}</code></pre>

  <p>This is exactly what <code>List&lt;T&gt;.Enumerator</code> does, and it is why
  <code>foreach</code> over a <code>List&lt;T&gt;</code> is free while the same loop over the same
  list typed as <code>IEnumerable&lt;int&gt;</code> is not.</p>

  <p><strong>The cost of the technique:</strong> a struct enumerator cannot be used with LINQ, cannot
  be returned as <code>IEnumerable</code> without boxing, and is forty lines instead of five.</p>
</section>

<section id="production">
  <h2>The Ledger handler, before and after</h2>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="675 bytes per request"><code>static long HandleBefore(PaymentRequest request)
{
    // 1. Split every header to find the tenant.
    string? tenant = null;
    foreach (string header in request.Headers)
    {
        string[] parts = header.Split(": ");
        if (parts[0].ToUpperInvariant() == "X-TENANT")
        {
            tenant = parts[1];
        }
    }

    // 2. LINQ over the headers to count trace headers.
    int traceCount = request.Headers.Count(h =&gt; h.StartsWith("x-trace", StringComparison.Ordinal));

    // 3. Interpolated response string.
    string response = $"{{\"key\":\"{request.IdempotencyKey}\",\"tenant\":\"{tenant}\"," +
                      $"\"amount\":{request.AmountMinor / 100m:F2},\"traces\":{traceCount}}}";

    return Checksum(response);
}</code></pre>

  <pre data-lang="console" data-title="04-production.cs"><code>   version    allocated       per request   gen0    time
   -------    ---------       -----------   ----    ----
   before    134,942,640 B         675 B     43     603 ms
   after      43,200,376 B         216 B     13     257 ms

   Projected at Ledger's 5,000 requests per second:

     before :    3.2 MB/s   ( 11.4 GB/hour)
     after  :    1.0 MB/s   (  3.6 GB/hour)</code></pre>

  <p>The five changes, in the order they were made:</p>

  <ol>
    <li><code>Split</code> + LINQ over headers → a span walk</li>
    <li>Interpolated response → <code>string.Create</code> at exact length</li>
    <li><code>ToUpper</code> for comparison → <code>OrdinalIgnoreCase</code> comparison</li>
    <li><code>IEnumerable&lt;T&gt;</code> parameter → the concrete list type</li>
    <li><code>object[]</code> logging arguments → a generic overload, no boxing</li>
  </ol>

  <p><strong>None of these changed the shape of the handler.</strong> They are the kind of edit a
  reviewer can check line by line, which is why they are the ones to make first — before anything
  involving a pool.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Change 3 is the one people get wrong. <code>a.ToUpperInvariant() == b</code> allocates a string
    to throw away. The fix is <code>string.Equals(a, b, StringComparison.OrdinalIgnoreCase)</code>,
    which allocates nothing <em>and</em> is more correct, because <code>ToUpper</code> comparison has
    culture bugs — the Turkish dotless i being the classic.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Optimising without measuring</h3>

  <p>Every measurement in this module has a version where the "optimisation" made things worse: the
  pool that was slower than allocating, the <code>string.Create</code> that allocated more than the
  interpolation it replaced, the <code>SearchValues</code> that lost to a plain <code>IndexOf</code>.
  None of those were predictable from reading the code.</p>

  <h3>2. Pooling something too small</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Slower than allocating"><code>// WRONG for a 64-byte buffer. Measured, this is roughly 2x slower than
// new byte[64] and about 2.5x slower than stackalloc.
byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(64);
try
{
    Format(payment, buffer);
}
finally
{
    ArrayPool&lt;byte&gt;.Shared.Return(buffer);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="A constant size belongs on the stack"><code>Span&lt;byte&gt; buffer = stackalloc byte[64];
Format(payment, buffer);</code></pre>

  <h3>3. A pool that is not bounded</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="A memory leak with a respectable name"><code>public sealed class BuilderPool
{
    // WRONG: unbounded. Every object ever returned is retained forever.
    // Under a traffic spike this grows to the peak concurrency and never
    // shrinks - and every retained object is promoted to gen 2.
    private readonly ConcurrentBag&lt;StringBuilder&gt; _pool = new();

    public StringBuilder Rent() =&gt; _pool.TryTake(out StringBuilder? b) ? b : new StringBuilder();

    public void Return(StringBuilder builder)
    {
        builder.Clear();
        _pool.Add(builder);
    }
}</code></pre>

  <p>The fix is a fixed-size array of slots and a <code>Return</code> that <em>drops</em> the object
  when the pool is full. That one dropped object is what makes the pool bounded.</p>

  <h3>4. Holding a reset that does not reset everything</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Leaks capacity, then leaks memory"><code>public void Return(StringBuilder builder)
{
    // WRONG: Clear() sets Length to 0 but keeps the CAPACITY. A builder
    // that once held a 10 MB document keeps 10 MB forever, and a pool of
    // eight of them retains 80 MB permanently.
    builder.Clear();
    _pool.Add(builder);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Drop anything that grew too far"><code>private const int MaxRetainedCapacity = 4 * 1024;

public void Return(StringBuilder builder)
{
    // A builder that grew beyond the ceiling is not worth retaining.
    // Dropping it costs one allocation next time and bounds the memory.
    if (builder.Capacity &gt; MaxRetainedCapacity)
    {
        return;
    }

    builder.Clear();
    _pool.Add(builder);
}</code></pre>

  <h3>5. Reaching for a pool where the object is immutable</h3>

  <p>Pooling only helps for objects you <em>mutate and reuse</em>. A pool of immutable value objects
  is pure overhead — you cannot reset them, so each rent needs a fresh one anyway.</p>

  <h3>6. Micro-optimising off the hot path</h3>

  <p>The techniques in this module make code harder to read, unusable with LINQ, and in the case of
  spans unusable across an <code>await</code>. Applied to a startup path, a configuration reader, or
  anything called once per request rather than once per item, they cost maintainability and buy
  nothing measurable.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a sawtooth in p99 latency, high generation 0 collection counts, or
    percentage of time in GC above about 5% with a flat heap.</p>
    <p><strong>Tools:</strong> <code>GC.GetTotalAllocatedBytes</code> first — it needs no profiler and
    is deterministic — then <code>dotnet-counters</code>, then a trace for the call sites.</p>
  </div>

  <h3>Step 1: measure bytes per operation</h3>

  <pre data-lang="csharp" data-net="10" data-title="The whole diagnostic, in five lines"><code>long before = GC.GetTotalAllocatedBytes(precise: true);

for (int i = 0; i &lt; iterations; i++)
{
    HandleRequest(request);
}

long perOperation = (GC.GetTotalAllocatedBytes(precise: true) - before) / iterations;
Console.WriteLine($"{perOperation} bytes per request");</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Warm up before measuring, and make sure the thing you are measuring happens <em>inside</em> the
    measured call. Three rows of the table in <code>04-production.cs</code> read 0 bytes in its first
    version, for three different reasons: a closure hoisted out of the measured lambda, overload
    resolution quietly picking a generic method over the <code>params</code> one, and the
    <code>Task&lt;int&gt;</code> cache hiding an async allocation.</p>
    <p>Measuring allocation is itself worth checking.</p>
  </div>

  <h3>Step 2: turn it into a test</h3>

  <pre data-lang="csharp" data-net="10" data-title="An allocation regression test"><code>[Fact]
public void HandlerAllocationDoesNotRegress()
{
    var request = BuildRequest();

    // Warm up: JIT, statics, and any first-call caches.
    for (int i = 0; i &lt; 1_000; i++)
    {
        Handler.Handle(request);
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);

    const int iterations = 10_000;
    for (int i = 0; i &lt; iterations; i++)
    {
        Handler.Handle(request);
    }

    long perRequest = (GC.GetTotalAllocatedBytes(precise: true) - before) / iterations;

    // A ceiling, not an exact figure - runtime versions change the details.
    Assert.True(perRequest &lt;= 256,
        $"allocated {perRequest} bytes per request, budget is 256");
}</code></pre>

  <p><strong>This is the single most valuable thing in the module.</strong> The number is
  deterministic, unlike timing, which varied by a factor of two across runs of identical code
  throughout this track. A test like this catches the regression on the pull request that causes it.</p>

  <h3>Step 3: find where the allocation is</h3>

  <pre data-lang="bash"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime
dotnet-trace collect --process-id 4821 --profile gc-verbose</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>What you see</th><th>Usual cause</th></tr>
      </thead>
      <tbody>
        <tr><td>Many <code>System.String</code></td><td>Substrings, interpolation, <code>ToString</code> in logging</td></tr>
        <tr><td>Many <code>System.Object[]</code></td><td><code>params</code> arrays, <code>string.Split</code></td></tr>
        <tr><td>Many <code>&lt;&gt;c__DisplayClass</code></td><td>Lambdas capturing locals</td></tr>
        <tr><td>Many boxed primitives</td><td><code>params object[]</code> logging, non-generic collections</td></tr>
        <tr><td>Many <code>WhereEnumerableIterator</code></td><td>LINQ on a hot path</td></tr>
        <tr><td>Many <code>Task&lt;T&gt;</code></td><td>Async methods returning results outside the cache range</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Step 4: let the analysers help</h3>

  <pre data-lang="xml" data-title="Directory.Build.props"><code>&lt;PropertyGroup&gt;
  &lt;AnalysisMode&gt;Recommended&lt;/AnalysisMode&gt;

  &lt;!-- CA1846: prefer AsSpan over Substring.
       CA1860: prefer Count/Length over Any().
       CA1861: constant arrays passed as arguments, allocated per call.
       CA2022: an inexact Stream.Read, which leaves buffers stale. --&gt;
  &lt;WarningsAsErrors&gt;$(WarningsAsErrors);CA1846;CA1860;CA1861;CA2022&lt;/WarningsAsErrors&gt;
&lt;/PropertyGroup&gt;</code></pre>

  <p><strong>CA1861</strong> is the one that finds the <code>IndexOfAny(new[] { ';', ',' })</code>
  pattern from earlier in this module — a constant array allocated on every call.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Zero allocation means fast."</strong></p>
    <p>Measured: the pooled version of the formatter allocated <em>nothing</em> and was slower than
    the version allocating 83 bytes per call, on every run. The pooled 64-byte buffer in the minimal
    example was the slowest of the three strategies.</p>
    <p>Allocation and speed are different axes. Optimise the one your measurement says is the
    problem.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"ArrayPool is always better than allocating."</strong></p>
    <p>Below about a kilobyte it lost on this machine — 0.62x at 32 bytes, 0.68x at 128. Above 64 KB
    it won by 47x, and at a megabyte by more than a thousand times, because that array would otherwise
    land on the large object heap.</p>
    <p>The size is the whole question.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Forgetting to return a rented array leaks memory."</strong></p>
    <p>It does not. The pool holds no reference to an array it never received, so the collector
    reclaims it normally. What it does is silently remove the entire benefit — measured, 156.7 MB
    allocated where the correct version allocated nothing — while the code still <em>looks</em> like
    it is pooling.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A pool needs to be unbounded so a rent never fails."</strong></p>
    <p>Renting from a bounded pool never fails either — an empty pool creates a new object. What
    bounding limits is how many are <em>retained</em>. An unbounded pool grows to peak concurrency and
    never shrinks, and every retained object is promoted to generation 2.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"string.Create is always better than interpolation."</strong></p>
    <p>Only if you can compute the exact length cheaply. A version that guessed a length, padded, and
    called <code>TrimEnd</code> allocated 168 bytes against interpolation's 112 — worse than what it
    replaced.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"async/await is free when the work completes synchronously."</strong></p>
    <p>An <code>async Task&lt;int&gt;</code> returning 1 allocates nothing; returning 1,000 allocates
    72 bytes. The difference is the runtime's <code>Task&lt;int&gt;</code> cache for results in −1 to
    8, not anything about your code.</p>
    <p>Return <code>ValueTask&lt;T&gt;</code> from methods that usually complete synchronously — but
    read the consumption rules first, because a <code>ValueTask</code> may only be awaited once.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Allocating less always helps latency."</strong></p>
    <p>It helps <em>tail</em> latency by making collections rarer. It rarely makes an individual
    operation faster — in the five-version rewrite, the biggest time win came from removing
    <code>Split</code> and a LINQ delegate, which was worth only 19 bytes per operation.</p>
    <p>The work removed and the bytes removed are not the same thing.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's handler went from 675 to 216 bytes per request. At 5,000 requests per second that is
    11.4 GB/hour down to 3.6 GB/hour, and 43 generation 0 collections down to 13 over the same
    workload.</p>
    <p>No individual request got meaningfully faster. The p99 sawtooth flattened, because the pauses
    that produced it became three times rarer. <strong>The beneficiary of an allocation reduction is
    never the code that allocated less</strong> — it is whatever else was running when the collection
    would have happened.</p>
    <p>That is also why this is worth doing in a shared process and usually not worth doing in a
    single-purpose batch job, where there is nobody else to protect.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Do this</th></tr>
      </thead>
      <tbody>
        <tr><td>Buffer under ~1 KB, constant size</td><td><code>stackalloc</code></td></tr>
        <tr><td>Buffer under ~1 KB, variable size</td><td>A plain array. Pooling loses here.</td></tr>
        <tr><td>Buffer over ~1 KB, or reaching the LOH</td><td><code>ArrayPool&lt;T&gt;</code>, returned in a <code>finally</code></td></tr>
        <tr><td>Buffer holding another user's data</td><td><code>Return(clearArray: true)</code>, always</td></tr>
        <tr><td>Building a string of computable length</td><td><code>string.Create</code></td></tr>
        <tr><td>Building a string of unknown length</td><td><code>StringBuilder</code>, reused if hot</td></tr>
        <tr><td>Searching for 3+ characters repeatedly</td><td><code>static readonly SearchValues&lt;T&gt;</code></td></tr>
        <tr><td>Searching for one character</td><td><code>IndexOf</code>. It is already vectorised.</td></tr>
        <tr><td>A hot method returning a sequence</td><td>A struct enumerator, if the profile justifies 40 lines</td></tr>
        <tr><td>Anything not shown to be hot</td><td>Nothing. Write the readable version.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Which of these allocate per call, and roughly how much?</p>
    <pre data-lang="csharp" data-net="10"><code>var list = new List&lt;int&gt; { 1, 2, 3, 4, 5 };
string text = "a,b,c";

var a = list.Count;
var b = list.Count();
var c = list.Where(static x =&gt; x &gt; 2).Count();
var d = text.Split(',').Length;
var e = string.Empty.Length;</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console"><code>   list.Count                                  0 B
   list.Count()  (LINQ)                        0 B
   list.Where(static x =&gt; x &gt; 2).Count()       96 B
   text.Split(',')                           120 B
   string.Empty                                0 B</code></pre>
        <p><code>list.Count</code> is a property — free.</p>
        <p><code>list.Count()</code> is the LINQ extension and reads 0 <em>because LINQ has a fast
        path for <code>ICollection&lt;T&gt;</code></em>. That is an optimisation inside LINQ, not a
        guarantee. On a type without the fast path it enumerates.</p>
        <p><strong><code>Where(...).Count()</code> is the one to notice</strong> — 96 bytes for the
        iterator object, even with a <code>static</code> lambda and no closure. The delegate is
        cached; the iterator is not.</p>
        <p><code>Split</code> allocates the array plus a string per field.
        <code>string.Empty</code> is a cached singleton.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Find both bugs in this method, and say what the user sees.</p>
    <pre data-lang="csharp" data-net="10"><code>public string ReadHeader(Stream stream, int length)
{
    byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(length);
    try
    {
        stream.Read(buffer);
        return Encoding.UTF8.GetString(buffer);
    }
    finally
    {
        ArrayPool&lt;byte&gt;.Shared.Return(buffer);
    }
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Bug 1:</strong> <code>buffer.Length</code> is not <code>length</code>.
        <code>Rent</code> rounds up to a power of two — a request for 50 returns 64.</p>
        <p><strong>Bug 2:</strong> <code>Read</code> returns how many bytes it actually read, which
        may be fewer than requested. The return value is discarded.</p>
        <p>Together they mean the string contains whatever the previous tenant left in the buffer:</p>
        <pre data-lang="console"><code>   requested 50 bytes, got Length 64
   GetString(buffer)        : "OKSTOMER-000512 BALANCE 998877"
   GetString(buffer, 0, 2)  : "OK"</code></pre>
        <p><strong>The user sees another user's data.</strong> This is a data-disclosure bug that
        passes every single-threaded test, because in a test the pool hands back a clean buffer.</p>
        <pre data-lang="csharp" data-net="10"><code>public string ReadHeader(Stream stream, int length)
{
    byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(length);
    try
    {
        // ReadExactly throws if the stream ends early, rather than
        // silently leaving the tail stale. CA2022 flags the Read version.
        stream.ReadExactly(buffer.AsSpan(0, length));

        return Encoding.UTF8.GetString(buffer.AsSpan(0, length));
    }
    finally
    {
        ArrayPool&lt;byte&gt;.Shared.Return(buffer, clearArray: true);
    }
}</code></pre>
        <p>Note also that this method is a poor candidate for pooling in the first place: if
        <code>length</code> is small, measured results say a plain <code>new byte[length]</code> is
        faster.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Reduce the allocation in this method without changing its signature. Say what each change is
    worth and where you would stop.</p>
    <pre data-lang="csharp" data-net="10"><code>public string Describe(Order order)
{
    var tags = order.Tags.Split(';');
    var visible = tags.Where(t =&gt; !t.StartsWith("internal")).ToList();

    return string.Format("ORD-{0} {1} items, tags: {2}",
        order.Id, order.LineCount, string.Join(", ", visible));
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>Count the allocations first, because that decides the order of work:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Line</th><th>Allocates</th></tr></thead>
            <tbody>
              <tr><td><code>Split(';')</code></td><td>The array, plus one string per tag</td></tr>
              <tr><td><code>Where(t =&gt; ...)</code></td><td>A closure is not needed here (no capture), but the iterator is — about 96 bytes</td></tr>
              <tr><td><code>.ToList()</code></td><td>A list plus its backing array</td></tr>
              <tr><td><code>string.Format(...)</code></td><td>A <code>params object[]</code>, and <code>order.Id</code> and <code>order.LineCount</code> are <strong>boxed</strong></td></tr>
              <tr><td><code>string.Join</code></td><td>An intermediate string, thrown away immediately</td></tr>
              <tr><td>The result</td><td>One string — the only allocation actually required</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>Step 1, the biggest win for the least risk:</strong> remove
        <code>Split</code>/<code>Where</code>/<code>ToList</code> and the boxing.</p>
        <pre data-lang="csharp" data-net="10"><code>public string Describe(Order order)
{
    var builder = new StringBuilder(64);
    builder.Append("ORD-").Append(order.Id)
           .Append(' ').Append(order.LineCount)
           .Append(" items, tags: ");

    bool first = true;
    ReadOnlySpan&lt;char&gt; remaining = order.Tags;

    while (!remaining.IsEmpty)
    {
        int semicolon = remaining.IndexOf(';');
        ReadOnlySpan&lt;char&gt; tag = semicolon &lt; 0 ? remaining : remaining[..semicolon];

        if (!tag.StartsWith("internal", StringComparison.Ordinal))
        {
            if (!first)
            {
                builder.Append(", ");
            }

            builder.Append(tag);
            first = false;
        }

        if (semicolon &lt; 0)
        {
            break;
        }

        remaining = remaining[(semicolon + 1)..];
    }

    return builder.ToString();
}</code></pre>
        <p><strong>What this removed:</strong> the split array and its strings, the LINQ iterator, the
        list, the <code>params object[]</code> and two boxes, and the intermediate join string.
        <code>StringBuilder.Append</code> has overloads for <code>long</code>, <code>int</code> and
        <code>ReadOnlySpan&lt;char&gt;</code>, so nothing is boxed and no substring is created.</p>
        <p><strong>Where I would stop: here.</strong> The remaining allocations are the
        <code>StringBuilder</code> and the final string, and the method's signature requires a string.
        Going further means <code>string.Create</code>, which needs the exact length computed up front
        — for a variable number of tags that is a second pass over the input and, as measured
        elsewhere in this module, guessing the length instead makes it worse.</p>
        <p>If a profile showed this dominating, the next step would be changing the signature to
        write into a caller-supplied <code>Span&lt;char&gt;</code> — but that is a change to every
        caller, and needs the measurement to justify it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>A colleague adds <code>ArrayPool</code> to a method that uses a 200-byte buffer, and the service
    gets slower. Explain why, and say what they should have done.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>200 bytes is far below the crossover.</strong> Measured:</p>
        <pre data-lang="console"><code>   size        new byte[]    ArrayPool    pool wins?
          32          2 ms          4 ms    NO (0.62x)
         128          3 ms          4 ms    NO (0.68x)
       1,024          7 ms          4 ms    yes (1.8x)
       8,192         48 ms          4 ms    yes (12.0x)</code></pre>
        <p>A generation 0 allocation is close to a pointer bump. <code>Rent</code> has to find the
        right bucket, check a thread-local cache, then a shared one; <code>Return</code> has to do the
        reverse. For 200 bytes that bookkeeping costs more than the allocation it replaces.</p>
        <p><strong>What they should have done, in order:</strong></p>
        <ol>
          <li><strong>Measured first.</strong> Bytes per operation before and after, and time before
          and after. This would have shown the regression immediately.</li>
          <li><strong>Used <code>stackalloc</code></strong> if the 200 is a compile-time constant.
          Zero allocation, no pool bookkeeping, and measured as the fastest of the three options.</li>
          <li><strong>Left it alone</strong> if the size is variable and under a kilobyte. The plain
          array is the right answer.</li>
        </ol>
        <pre data-lang="csharp" data-net="10"><code>// If the size is a constant:
Span&lt;byte&gt; buffer = stackalloc byte[200];

// If it is variable, with a stack fast path:
const int StackLimit = 256;
byte[]? rented = null;
Span&lt;byte&gt; buffer2 = length &lt;= StackLimit
    ? stackalloc byte[StackLimit]
    : (rented = ArrayPool&lt;byte&gt;.Shared.Rent(length));

try
{
    Process(buffer2[..length]);
}
finally
{
    if (rented is not null)
    {
        ArrayPool&lt;byte&gt;.Shared.Return(rented);
    }
}</code></pre>
        <p><strong>The general point:</strong> "reduce allocations" is not a goal in itself. Every
        technique here has a range where it wins and a range where it loses, and the only way to know
        which side you are on is to measure.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Write a bounded object pool for <code>StringBuilder</code>. Then list every way a caller can
    misuse it, and say which ones your design survives.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10"><code>using System.Text;

public sealed class BuilderPool
{
    // A builder that grew beyond this is not worth retaining: Clear() resets
    // Length but keeps Capacity, so one 10 MB document would be held forever.
    private const int MaxRetainedCapacity = 4 * 1024;

    private readonly StringBuilder?[] _slots;

    public BuilderPool(int maxRetained = 16)
    {
        _slots = new StringBuilder?[maxRetained];
    }

    public StringBuilder Rent()
    {
        for (int i = 0; i &lt; _slots.Length; i++)
        {
            StringBuilder? builder = Interlocked.Exchange(ref _slots[i], null);
            if (builder is not null)
            {
                return builder;
            }
        }

        // Empty pool: create. Renting must always succeed.
        return new StringBuilder(256);
    }

    public void Return(StringBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        // Drop anything that grew too far, so retained memory is bounded by
        // maxRetained * MaxRetainedCapacity rather than by the largest
        // document ever formatted.
        if (builder.Capacity &gt; MaxRetainedCapacity)
        {
            return;
        }

        // Reset on RETURN, so the pool never holds live data while idle.
        builder.Clear();

        for (int i = 0; i &lt; _slots.Length; i++)
        {
            if (Interlocked.CompareExchange(ref _slots[i], builder, null) is null)
            {
                return;
            }
        }

        // Pool full: drop it. This line is what makes the pool BOUNDED, and
        // it is the one a naive implementation leaves out.
    }
}</code></pre>
        <p><strong>Every way a caller can misuse it, and what happens:</strong></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Misuse</th><th>Outcome</th><th>Survives?</th></tr></thead>
            <tbody>
              <tr><td>Never returns</td><td>Pool creates new builders. Loses the benefit, corrupts nothing.</td><td><strong>Yes</strong></td></tr>
              <tr><td>Returns twice</td><td>The builder occupies two slots. Two renters get the same instance and corrupt each other.</td><td><strong>No</strong> — see below</td></tr>
              <tr><td>Returns a builder it did not rent</td><td>Harmless; the pool has no ownership state.</td><td><strong>Yes</strong></td></tr>
              <tr><td>Keeps using it after returning</td><td>Writes into a builder another thread is using.</td><td><strong>No</strong> — see below</td></tr>
              <tr><td>Returns null</td><td>Throws <code>ArgumentNullException</code> at the call site.</td><td><strong>Yes</strong></td></tr>
              <tr><td>Returns a 10 MB builder</td><td>Dropped rather than retained.</td><td><strong>Yes</strong></td></tr>
              <tr><td>Concurrent rent and return</td><td>Interlocked on every slot; no lost or duplicated builders.</td><td><strong>Yes</strong></td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The two it does not survive are the same bug as double-return on
        <code>ArrayPool</code>, and the measured consequence there is severe:</strong></p>
        <pre data-lang="console"><code>   two independent renters got the SAME array: True
   renter A wrote 111, then renter B wrote 222
   renter A now reads: 222</code></pre>
        <p>Fix it at the call site with a struct that can only release once:</p>
        <pre data-lang="csharp" data-net="10"><code>public readonly struct PooledBuilder : IDisposable
{
    private readonly BuilderPool _pool;

    public PooledBuilder(BuilderPool pool)
    {
        _pool = pool;
        Builder = pool.Rent();
    }

    public StringBuilder Builder { get; }

    public void Dispose() =&gt; _pool.Return(Builder);
}

// Usage: the lifetime is a block, and there is no variable to return twice.
using var scope = new PooledBuilder(pool);
scope.Builder.Append("ORD-").Append(orderId);
string result = scope.Builder.ToString();</code></pre>
        <p><strong>Honest caveat:</strong> a readonly struct <code>Dispose</code> can still be called
        twice if the caller works at it. Ownership bugs cannot be fully prevented by a pool — only
        made harder to write. That is why the shipping answer is
        <code>Microsoft.Extensions.ObjectPool</code>, and why the reset policy is the part worth your
        attention.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>You are handed the five-version table from this module and asked "which version should we
    ship?". Answer it properly: state what you would need to know, what you would measure, and give a
    default.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console"><code>   version                        per op     gen0     time (across runs)
   v1 interpolation + LINQ           187 B     29      491-618 ms
   v2 StringBuilder, reused          169 B     26      215-286 ms
   v3 string.Create + spans           83 B     13      195-262 ms
   v4 UTF-8 into a pooled buffer       0 B      0      241-372 ms
   v5 UTF-8 into stackalloc            0 B      0      102-204 ms</code></pre>
        <p><strong>First: v4 is eliminated on the evidence.</strong> It allocates nothing and is
        slower than v3, on every run. Whatever else is true, there is no argument for shipping it —
        v5 achieves the same zero allocation and is faster.</p>
        <p><strong>What I would need to know:</strong></p>
        <ol>
          <li><strong>Is this path actually hot?</strong> If it runs once per request rather than once
          per line item, 187 bytes is nothing and v1 is fine. Measure bytes per <em>request</em>, not
          per call.</li>
          <li><strong>What is the current percentage of time in GC?</strong> Below about 5% there is
          no problem to solve and every version below v1 is a cost with no benefit.</li>
          <li><strong>Is the consumer able to take a span?</strong> v5 hands out a
          <code>ReadOnlySpan&lt;byte&gt;</code>, which cannot cross an <code>await</code>, be stored,
          or be passed to a logging framework that wants a string. If the sink is
          <code>ILogger</code>, v5 is not available at any price.</li>
          <li><strong>Who maintains this?</strong> v5 is about forty lines of buffer arithmetic. On a
          path changed monthly by people who did not write it, that is a real risk.</li>
        </ol>
        <p><strong>What I would measure, in order:</strong></p>
        <ol>
          <li>Bytes allocated per request end to end, with two
          <code>GC.GetTotalAllocatedBytes</code> calls. Deterministic, no profiler.</li>
          <li>Percentage of time in GC from <code>dotnet-counters</code>, under representative
          load.</li>
          <li>Whether p99 shows the sawtooth. That is the symptom this work fixes; if it is absent,
          the work has no observable payoff.</li>
        </ol>
        <p><strong>The default, absent that evidence: ship v2.</strong> It is roughly twice as fast as
        v1 for a two-line change any reviewer can check, and it removes the two constructs
        (<code>Split</code> and a LINQ delegate) that are pure waste regardless of how hot the path
        is.</p>
        <p><strong>If the measurements say this path dominates: ship v3.</strong> It halves allocation
        again, still returns a string, and stays readable.</p>
        <p><strong>Ship v5 only if</strong> all four questions above come out in its favour — hot
        path, GC time actually a problem, consumer takes a span, and the team can maintain it. That is
        a narrow set of circumstances, and being able to say so precisely is the point of the
        exercise.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Does zero allocation mean fast?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. Measured, the pooled version of the formatter allocated
        nothing and was slower than the version allocating 83 bytes per call, on every run. Renting a
        64-byte buffer costs more than allocating one.</p></div>
      </details></li>

    <li><p>What does <code>ArrayPool.Rent(100)</code> give you?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An array of <strong>at least</strong> 100 — measured, 128, because
        the pool keeps power-of-two buckets with a minimum of 16. Using <code>.Length</code> instead of
        the count you asked for or wrote exposes the previous tenant's data.</p></div>
      </details></li>

    <li><p>What happens if you return the same array twice?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It occupies two slots, and two independent renters get the same
        instance — verified. They then overwrite each other silently, with no exception. Null the
        field as you return it so a second return has nothing to give back.</p></div>
      </details></li>

    <li><p>Is forgetting to return a rented array a memory leak?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No — the pool holds no reference to it, so the collector reclaims
        it normally. It silently removes the benefit instead: measured, 156.7 MB allocated where the
        correct version allocated nothing, while the code still looks like it is pooling.</p></div>
      </details></li>

    <li><p>Roughly what size does pooling start to pay?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>About a kilobyte on the machine measured — 0.62x at 32 bytes,
        1.8x at 1,024, 47x at 65,536. Below that, use <code>stackalloc</code> for a constant size and a
        plain array otherwise.</p></div>
      </details></li>

    <li><p>Name three allocations that contain no <code>new</code> keyword.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A lambda capturing a local (88 bytes, for the display class and
        delegate); <code>foreach</code> over a collection typed as <code>IEnumerable&lt;T&gt;</code>
        (40 bytes, boxing the struct enumerator); and a <code>params</code> array (120 bytes, plus a
        box per value-type argument).</p></div>
      </details></li>

    <li><p>Why can a microbenchmark make <code>async</code> look free?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The runtime caches <code>Task&lt;int&gt;</code> objects for
        results in −1 to 8. Identical code returning 1 allocates nothing and returning 1,000 allocates
        72 bytes.</p></div>
      </details></li>

    <li><p>What makes an object pool bounded, and why does it matter?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A <code>Return</code> that <strong>drops</strong> the object when
        every slot is full. Without it the pool retains every object ever returned, grows to peak
        concurrency, never shrinks, and promotes all of it to generation 2.</p>
        <p>Renting from a bounded pool still never fails — an empty pool creates a new object.</p></div>
      </details></li>

    <li><p>When is <code>SearchValues</code> the wrong tool?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>For one or two values — plain <code>IndexOf</code> is already
        vectorised and measured 15 ms against <code>SearchValues</code>' 39 ms. And whenever it is
        constructed inside the hot method rather than held in a <code>static readonly</code> field,
        because construction is the expensive part.</p></div>
      </details></li>

    <li><p>What is the single most useful thing to put in the test suite after this module?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An allocation budget assertion: warm up, collect, measure
        <code>GC.GetTotalAllocatedBytes</code> across N operations, assert bytes-per-operation is under
        a ceiling.</p>
        <p>The number is deterministic, unlike timing, which varied by a factor of two across runs of
        identical code throughout this track. It catches the regression on the pull request that
        causes it.</p></div>
      </details></li>
  </ol>
</section>
`
});
