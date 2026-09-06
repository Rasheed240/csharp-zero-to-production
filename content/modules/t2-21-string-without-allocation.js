CSPREP.module({
  id: "t2-21-string-without-allocation",
  minutes: 55,
  updated: "2026-09-02",
  summary: "A three-character string costs 32 bytes, because .NET strings are UTF-16 with 22 bytes of header - and the settlement file that is 16 MB on disk becomes 32 MB the moment you decode it. Ledger's audit writer went from 288 bytes per line to 80 with Utf8.TryWrite and to 0 by hand. The custom interpolated string handler is the standout: 500,000 disabled log calls formatted 0 values and allocated 376 bytes in total, with no guard at the call site - and the arguments are never even evaluated, which is the feature and also its sharpest edge.",
  terms: ["UTF-16", "UTF-8", "string overhead", "immutability", "ordinal comparison",
    "culture-sensitive comparison", "Turkish I problem", "string.Create",
    "interpolated string handler", "DefaultInterpolatedStringHandler",
    "InterpolatedStringHandlerArgument", "conditional evaluation", "UTF-8 literal",
    "Utf8.TryWrite", "Utf8Formatter", "Utf8Parser", "TryGetBytes", "code unit",
    "replacement character", "allocation floor"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger writes one audit line per payment. The line is 56 bytes of UTF-8 text. The code that
  produces it looks like nothing at all:</p>

  <pre data-lang="csharp" data-net="10"><code>string line = $"{payment.Timestamp:O}|{payment.Id}|" +
              $"{payment.Currency.ToUpper()}|{payment.AmountMinor / 100m:F2}|" +
              $"{payment.Status}\n";

byte[] bytes = Encoding.UTF8.GetBytes(line);</code></pre>

  <p>Measured, that allocates <strong>288 bytes to produce 56 bytes of output</strong>, and it was the
  single largest allocator in the service.</p>

  <p>It also contains two bugs that have nothing to do with performance, and they are worth spotting
  before the allocation:</p>

  <ul>
    <li>There is no culture. On a machine where the decimal separator is a comma, this writes
    <code>1234,50</code> into a pipe-delimited file that another system parses as two fields.</li>
    <li><code>ToUpper()</code> is culture-sensitive. In Turkish, uppercasing <code>i</code> does not
    produce <code>I</code> — so a currency code or header name containing an <code>i</code> stops
    matching, on some machines only.</li>
  </ul>

  <p>Fixing both, and then removing the intermediate string, gives this:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   version                          allocated    per line    gen0     time   bytes
   -------                          ---------    --------    ----     ----   -----
   v1 interpolation + GetBytes      86,284,008 B       288 B     27     337 ms      56
   v2 culture fixed, ToUpper gone   59,283,352 B       198 B     18     286 ms      56
   v3 Utf8.TryWrite into stack      24,000,376 B        80 B      7     189 ms      56
   v4 hand-written UTF-8                   376 B         0 B      0     110 ms      56</code></pre>

  <p>The <code>bytes</code> column is a correctness check — every version must produce the same output
  or the comparison means nothing.</p>

  <p>This module is about where those 288 bytes come from, and about the two features that remove most
  of them without making the code worse: <strong>UTF-8 literals</strong> and <strong>interpolated
  string handlers</strong>. It also measures, honestly, why v3 stops at 80 rather than 0 — which turns
  out not to be anything v3 does wrong.</p>
</section>

<section id="plain-language">
  <h2>What a string actually is</h2>

  <p class="define"><span class="define__term">UTF-16</span> The encoding .NET uses for
  <code>string</code> and <code>char</code> in memory: <strong>two bytes per character</strong> for
  everything in the common range, and four for the rest. Not one byte, whatever the content.</p>

  <p class="define"><span class="define__term">UTF-8</span> The encoding used by essentially every
  file, HTTP body and network protocol: one byte for ASCII, two to four for everything else.</p>

  <p class="define"><span class="define__term">Code unit</span> One indexable element of an encoded
  string. <code>string.Length</code> counts UTF-16 code units, not characters a human would count and
  not bytes.</p>

  <p class="define"><span class="define__term">Immutability</span> A .NET string cannot be changed
  after it is created. Every method that looks like a mutation —
  <code>Trim</code>, <code>ToUpper</code>, <code>Replace</code>, <code>PadLeft</code> — returns a
  <em>new</em> string.</p>

  <p>Put together, that gives the cost model:</p>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   text                chars   on the heap   UTF-8 would be
   ----                -----   -----------   --------------
   GBP                      3            32                3
   INV-2026-0004821        16            56               16
   OK                       2            32                2</code></pre>

  <p class="define"><span class="define__term">String overhead</span> 22 bytes on 64-bit before any
  characters: 8 for the sync block index, 8 for the method table pointer, 4 for the length, 2 for a
  terminating null. The total is rounded up to a multiple of 8.</p>

  <p><strong>So <code>"GBP"</code> costs 32 bytes to hold 3 bytes of information</strong> — a factor
  of ten. A settlement file that is 16 MB of ASCII on disk becomes 32 MB the moment it is decoded into
  strings, before any parsing happens.</p>

  <p><strong>An analogy, and its limits.</strong> Think of a string as a framed photograph. The frame
  is a fixed cost whatever the picture, and you cannot repaint the picture — changing anything means
  a whole new frame and a new print. A short caption in a big frame is mostly frame.</p>

  <p><strong>Where the analogy breaks:</strong> a frame is obvious when you look at it. String
  overhead is invisible in source code — <code>"GBP"</code> looks like it costs three of something.
  And unlike frames, the runtime sometimes hands you back the <em>same</em> print when nothing
  changed, which makes measurement surprising in a way this module returns to.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's audit writer allocated 288 bytes per payment. At 5,000 payments per second that is
    1.4 MB/s, or 4.9 GB an hour, to write 56-byte lines.</p>
    <p>None of it leaked and none of it was slow on its own. It caused 27 generation 0 collections in
    the measured window, each one a pause landing on whichever request was in flight. The fix took it
    to 7 collections without changing a single line of output.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — A string is UTF-16 and immutable. Every operation
// that looks like a mutation produces a second one.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Globalization;
using System.Text.Unicode;

const string Header = "x-tenant";
const int Iterations = 500_000;

// "GBP" is three characters and costs 32 bytes: 22 of overhead plus 2 per
// character, rounded up to a multiple of 8.
Console.WriteLine($"\"GBP\" as a string : {32} bytes on the heap");
Console.WriteLine($"\"GBP\"u8           : {"GBP"u8.Length} bytes, and no allocation at all");
Console.WriteLine();

Console.WriteLine("Comparing a header name, two ways:");
Console.WriteLine();
Measure("  ToUpper() ==                  ", static () =&gt;
    Header.ToUpper() == "X-TENANT");
Measure("  Equals(OrdinalIgnoreCase)     ", static () =&gt;
    string.Equals(Header, "x-tenant", StringComparison.OrdinalIgnoreCase));

Console.WriteLine();
Console.WriteLine("The first allocates a string per call to throw it away - and is also");
Console.WriteLine("wrong in Turkish, where uppercasing 'i' does not produce 'I'.");
Console.WriteLine();

Console.WriteLine("Writing a response body, two ways:");
Console.WriteLine();
MeasureBytes("  string, then GetBytes         ", static () =&gt;
{
    string json = string.Create(CultureInfo.InvariantCulture, $"{{\"id\":{4000821}}}");
    return System.Text.Encoding.UTF8.GetBytes(json).Length;
});
MeasureBytes("  Utf8.TryWrite into the stack  ", static () =&gt;
{
    Span&lt;byte&gt; buffer = stackalloc byte[32];
    Utf8.TryWrite(buffer, CultureInfo.InvariantCulture, $"{{\"id\":{4000821}}}", out int written);
    return written;
});

Console.WriteLine();
Console.WriteLine("The second never creates a UTF-16 string at all. It does not reach zero,");
Console.WriteLine("because the value-type hole is boxed by the handler on this runtime -");
Console.WriteLine("measured at 24 bytes for a long. Removing that last 24 needs");
Console.WriteLine("Utf8Formatter called directly, and three times the code.");

static void Measure(string label, Func&lt;bool&gt; body)
{
    for (int i = 0; i &lt; 1_000; i++)
    {
        body();
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);

    bool last = false;
    for (int i = 0; i &lt; Iterations; i++)
    {
        last = body();
    }

    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;
    Console.WriteLine($"{label} {allocated,12:N0} B   ({allocated / (double)Iterations,4:F0} B per call, result {last})");
}

static void MeasureBytes(string label, Func&lt;int&gt; body)
{
    for (int i = 0; i &lt; 1_000; i++)
    {
        body();
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);

    long sink = 0;
    for (int i = 0; i &lt; Iterations; i++)
    {
        sink += body();
    }

    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;
    Console.WriteLine($"{label} {allocated,12:N0} B   ({allocated / (double)Iterations,4:F0} B per call, sink {sink})");
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>"GBP" as a string : 32 bytes on the heap
"GBP"u8           : 3 bytes, and no allocation at all

Comparing a header name, two ways:

  ToUpper() ==                     20,000,336 B   (  40 B per call, result True)
  Equals(OrdinalIgnoreCase)               336 B   (   0 B per call, result True)

Writing a response body, two ways:

  string, then GetBytes            48,000,872 B   (  96 B per call, sink 7000000)
  Utf8.TryWrite into the stack     12,000,336 B   (  24 B per call, sink 7000000)</code></pre>

  <p>Both pairs do identical work and produce identical answers. The difference in each case is
  whether an intermediate string is created and thrown away.</p>
</section>

<section id="what-allocates">
  <h2>Which string operations allocate</h2>

  <pre data-lang="console" data-title="01-string-costs.cs"><code>   operation                          allocated per call
   ---------                          ------------------
   Trim()                                 56 B
   AsSpan().Trim()                         0 B
   ToUpperInvariant(), has lowercase       64 B
   ToUpperInvariant(), already upper        0 B
   Substring(2, 16)                       56 B
   AsSpan(2, 16)                           0 B
   Replace("-", "")                       64 B
   PadLeft(30)                            88 B
   string.Concat(a, b)                   104 B
   ToString() on a string                  0 B</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Look at the two <code>ToUpperInvariant</code> rows. <strong>Same method, different data,
    opposite results.</strong> When the result would be identical to the input, the BCL returns the
    input rather than allocating a copy.</p>
    <p>That is a real optimisation and a genuine benchmarking hazard: a case-conversion measured on
    already-uppercase test data reports zero cost and tells you nothing about production.</p>
  </div>

  <h3>Comparison without allocating, and without a culture bug</h3>

  <pre data-lang="console" data-title="01-string-costs.cs"><code>   approach                                  allocated     time   result
   --------                                  ---------     ----   ------
   ToUpperInvariant() ==                    160,000,376 B     196 ms   True
   ToLowerInvariant() ==                     80,000,376 B     147 ms   True
   string.Equals(OrdinalIgnoreCase)                376 B      67 ms   True
   span.Equals(OrdinalIgnoreCase)                  376 B      95 ms   True</code></pre>

  <p class="define"><span class="define__term">Ordinal comparison</span> Comparing code units
  directly, with no cultural rules. Fast, allocation-free, and the correct choice for anything a
  machine produced: identifiers, header names, file paths, protocol tokens, currency codes.</p>

  <p class="define"><span class="define__term">Culture-sensitive comparison</span> Comparing according
  to a language's rules. Correct only for text a human will read as sorted — names in a list, search
  results. It is the default for some methods, which is a persistent source of bugs.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The <code>ToUpper</code> comparison is not only 160 MB of waste — it is <strong>wrong</strong>.
    <code>ToUpper()</code> without a culture argument uses the current culture, and in Turkish
    uppercasing <code>i</code> produces a dotted capital I rather than <code>I</code>.</p>
    <p>A header check on <code>x-idempotency-key</code> therefore fails on a Turkish machine and
    passes everywhere your tests run. This is a real class of production incident, and the fix —
    <code>StringComparison.OrdinalIgnoreCase</code> — happens to be the fast one too.</p>
  </div>

  <h3>Building one string</h3>

  <pre data-lang="console" data-title="01-string-costs.cs"><code>   approach                     allocated   per call     time
   --------                     ---------   --------     ----
   concatenation with +         76,000,376 B      152 B      97 ms
   string.Format                64,000,376 B      128 B     228 ms
   interpolation                52,000,912 B      104 B     155 ms
   string.Create, exact size    36,000,376 B       72 B     211 ms</code></pre>

  <p><strong>Interpolation is not <code>string.Format</code>.</strong> Since C# 10 it compiles to
  <code>DefaultInterpolatedStringHandler</code>, which writes into a pooled buffer and produces one
  string at the end — no <code>object[]</code>, no boxing. That is why it beats both the
  <code>+</code> chain and <code>string.Format</code>.</p>

  <p><code>string.Create</code> wins on allocation because it writes into the final string's own
  memory. Note it is <em>slower</em> here, and about twenty lines against one. Both of those are the
  real cost and neither appears in the allocation column.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>string.Create</code> only wins if you can compute the exact length <strong>without
    allocating</strong>. An earlier version of this measurement used
    <code>id.ToString().Length</code> to get the length — which allocates, and made
    <code>string.Create</code> allocate <em>more</em> than the interpolation it was meant to beat:
    112 bytes against 104.</p>
    <p>Count digits arithmetically, or use interpolation.</p>
  </div>
</section>

<section id="handlers">
  <h2>Interpolated string handlers</h2>

  <p class="define"><span class="define__term">Interpolated string handler</span> A type the compiler
  builds an interpolated string into, instead of producing a <code>string</code>. Which handler is
  used is decided by <strong>overload resolution on the parameter type</strong>, so a method can take
  control of how — and whether — the formatting happens.</p>

  <pre data-lang="console" data-title="02-interpolated-handlers.cs"><code>   Source:
     string s = $"PAY-{id} settled";

   Roughly what the compiler emits since C# 10:
     var handler = new DefaultInterpolatedStringHandler(13, 1);
     handler.AppendLiteral("PAY-");
     handler.AppendFormatted(id);
     handler.AppendLiteral(" settled");
     string s = handler.ToStringAndClear();</code></pre>

  <p>Two things follow, and the second is the point of this section.</p>

  <p><strong><code>AppendFormatted</code> is generic</strong>, so the id is formatted straight into
  the handler's buffer without being boxed into an <code>object[]</code> the way
  <code>string.Format</code> would.</p>

  <p><strong>The handler type is chosen by the method you call.</strong> Declare your own, and you
  decide whether any of the work happens.</p>

  <h3>The logging problem</h3>

  <pre data-lang="console" data-title="02-interpolated-handlers.cs"><code>   Logging is DISABLED for all of these. Nothing is written.

   approach                              allocated   formatted     time
   --------                              ---------   ---------     ----
   LogDebug($"...")  string parameter    76,000,912 B     500,000     123 ms
   if (IsEnabled) LogDebug($"...")               376 B           0       3 ms</code></pre>

  <p>The parameter is a <code>string</code>, so the string must <em>exist</em> before the call. The
  method cannot decline work that has already happened. Half a million strings were built and
  discarded while logging was switched off.</p>

  <p>The guard fixes it and costs three lines at every call site, which is why it is so often missing.</p>

  <h3>A handler that removes the guard</h3>

  <pre data-lang="csharp" data-net="10" data-title="02-interpolated-handlers.cs"><code>sealed class HandlerLogger
{
    public bool Enabled { get; set; }

    public int Formatted { get; set; }

    public int Counter =&gt; 42;

    // The handler type as the parameter is what makes this work. The compiler
    // rewrites the call site to construct it and append into it.
    public void LogDebug([InterpolatedStringHandlerArgument("")] ref DebugLogHandler handler)
    {
        if (!Enabled)
        {
            return;
        }

        _ = handler.ToStringAndClear().Length;
    }
}

// ---------------------------------------------------------------------------
// The handler. Three requirements: the attribute, a constructor with
// (literalLength, formattedCount), and AppendLiteral/AppendFormatted methods.
//
// The extra constructor parameters come from InterpolatedStringHandlerArgument
// on the method above: "" means the receiver, so the logger is passed in.
//
// The final out bool is the mechanism: returning false tells the compiler to
// skip every append AND to skip evaluating the arguments.</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-interpolated-handlers.cs"><code>[InterpolatedStringHandler]
internal ref struct DebugLogHandler
{
    private DefaultInterpolatedStringHandler _inner;
    private readonly HandlerLogger _logger;
    private readonly bool _enabled;

    public DebugLogHandler(int literalLength, int formattedCount, HandlerLogger logger,
        out bool shouldAppend)
    {
        _logger = logger;
        _enabled = logger.Enabled;
        shouldAppend = _enabled;

        _inner = _enabled
            ? new DefaultInterpolatedStringHandler(literalLength, formattedCount)
            : default;
    }

    public void AppendLiteral(string value)
    {
        if (!_enabled)
        {
            return;
        }

        _logger.Formatted++;
        _inner.AppendLiteral(value);
    }

    public void AppendFormatted&lt;T&gt;(T value)
    {
        if (!_enabled)
        {
            return;
        }

        _logger.Formatted++;
        _inner.AppendFormatted(value);
    }

    public void AppendFormatted&lt;T&gt;(T value, string? format)
    {
        if (!_enabled)
        {
            return;
        }

        _logger.Formatted++;
        _inner.AppendFormatted(value, format);
    }

    public string ToStringAndClear() =&gt; _enabled ? _inner.ToStringAndClear() : string.Empty;
}</code></pre>

  <pre data-lang="console" data-title="02-interpolated-handlers.cs"><code>   approach                              allocated   formatted     time
   --------                              ---------   ---------     ----
   LogDebug($"...")  custom handler             376 B           0      16 ms
   the same, logging ENABLED              76,000,912 B   2,000,000     148 ms</code></pre>

  <p>Same call site, <strong>no guard</strong>, and nothing is formatted while logging is off.</p>

  <p>Three requirements make it work: the <code>[InterpolatedStringHandler]</code> attribute, a
  constructor taking <code>(int literalLength, int formattedCount)</code>, and
  <code>AppendLiteral</code>/<code>AppendFormatted</code> methods.</p>

  <p>The two pieces that do the real work are <code>[InterpolatedStringHandlerArgument("")]</code> on
  the method — <code>""</code> means the receiver, so the logger is passed to the handler's
  constructor — and the final <code>out bool shouldAppend</code> parameter.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>That <code>out bool</code> is the mechanism worth remembering. Returning <code>false</code>
    tells the <strong>compiler</strong> to skip every <code>AppendFormatted</code> call. The skipping
    is done by generated code at the call site, not by the handler returning early — so the arguments
    are never evaluated at all.</p>
  </div>

  <h3>The sharp edge</h3>

  <pre data-lang="console" data-title="02-interpolated-handlers.cs"><code>   logging disabled, side-effecting argument ran 0 time(s)
   logging enabled,  side-effecting argument ran 1 time(s)</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>An expression inside an interpolation hole is <strong>not evaluated</strong> when the handler
    says it is not interested. That is exactly what you want for an expensive
    <code>ToString</code>.</p>
    <p>It is a bug if the expression has a side effect — incrementing a counter, advancing an
    enumerator, calling something that mutates state. That code will run in some environments and not
    others, decided by a log level.</p>
    <p><strong>The rule: an interpolation hole must be a pure expression.</strong></p>
  </div>
</section>

<section id="utf8">
  <h2>UTF-8: literals, writing, and parsing in place</h2>

  <pre data-lang="console" data-title="03-utf8.cs"><code>   text                       chars   UTF-16 bytes   UTF-8 bytes
   ----                       -----   ------------   -----------
   INV-2026-0004821              16             32            16
   Ledger Zahlungsübersicht      24             48            25
   settled                        7             14             7</code></pre>

  <p>For ASCII, UTF-8 is half the size. Note the middle row: UTF-8 is <em>larger</em> there, because
  the u-umlaut needs two bytes. <strong>UTF-8 is not universally smaller — it is smaller for the ASCII
  that dominates machine-readable formats.</strong></p>

  <p class="define"><span class="define__term">UTF-8 literal</span> A string literal suffixed with
  <code>u8</code>, producing a <code>ReadOnlySpan&lt;byte&gt;</code> of UTF-8 bytes baked into the
  assembly at compile time. No allocation, no encoding step at runtime.</p>

  <pre data-lang="console" data-title="03-utf8.cs"><code>   approach                             allocated     time
   --------                             ---------     ----
   Encoding.UTF8.GetBytes("GBP")        64,000,912 B      69 ms
   "GBP"u8                                     912 B      22 ms</code></pre>

  <h3>Writing without a string</h3>

  <pre data-lang="console" data-title="03-utf8.cs"><code>   approach                             allocated   per call     time
   --------                             ---------   --------     ----
   string, then GetBytes                90,523,936 B      181 B     296 ms
   string, then TryGetBytes to buffer    59,429,248 B      119 B     253 ms
   straight to UTF-8, no string                376 B        0 B     123 ms</code></pre>

  <p><strong>The middle row is the one to learn from.</strong> It writes into a stack buffer and still
  allocates 119 bytes per call, because it builds the <em>string</em> first. Removing the output array
  does not help while the intermediate string still exists.</p>

  <p class="define"><span class="define__term">Utf8.TryWrite</span> An interpolated string handler
  that writes UTF-8 directly into a <code>Span&lt;byte&gt;</code>. The readability of interpolation
  with no UTF-16 string produced at any point.</p>

  <pre data-lang="csharp" data-net="10" data-title="The tidy form"><code>using System.Globalization;
using System.Text.Unicode;

Span&lt;byte&gt; buffer = stackalloc byte[64];

if (Utf8.TryWrite(buffer, CultureInfo.InvariantCulture,
    $"{{\"id\":{id},\"amount\":{amountMinor / 100m:F2}}}", out int written))
{
    await destination.WriteAsync(buffer[..written].ToArray(), cancellationToken);
}
else
{
    // Never ignore the false. A real writer falls back to a pooled buffer
    // here rather than silently truncating the response.
    throw new InvalidOperationException("response exceeded the buffer");
}</code></pre>

  <h3>Parsing a request line without a string</h3>

  <pre data-lang="console" data-title="03-utf8.cs"><code>   raw line : POST /v1/payments/4000821 HTTP/1.1
   method   : POST  (matched with "POST"u8: True)
   path     : /v1/payments/4000821
   payment id: 4000821   (parsed from bytes, no string created)</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-utf8.cs"><code>static void ParsingInPlace()
{
    Console.WriteLine("4. Parsing a request line without a string");
    Console.WriteLine();

    ReadOnlySpan&lt;byte&gt; line = "POST /v1/payments/4000821 HTTP/1.1"u8;

    // Find the two spaces. No decoding, no allocation.
    int firstSpace = line.IndexOf((byte)' ');
    ReadOnlySpan&lt;byte&gt; method = line[..firstSpace];

    ReadOnlySpan&lt;byte&gt; rest = line[(firstSpace + 1)..];
    int secondSpace = rest.IndexOf((byte)' ');
    ReadOnlySpan&lt;byte&gt; path = rest[..secondSpace];

    Console.WriteLine($"   raw line : {Encoding.UTF8.GetString(line)}");
    Console.WriteLine($"   method   : {Encoding.UTF8.GetString(method)}  (matched with \"POST\"u8: {method.SequenceEqual("POST"u8)})");
    Console.WriteLine($"   path     : {Encoding.UTF8.GetString(path)}");

    // Pull the id out of the path and parse it, still without a string.
    int lastSlash = path.LastIndexOf((byte)'/');
    ReadOnlySpan&lt;byte&gt; idBytes = path[(lastSlash + 1)..];

    if (Utf8Parser.TryParse(idBytes, out long paymentId, out _))
    {
        Console.WriteLine($"   payment id: {paymentId}   (parsed from bytes, no string created)");</code></pre>

  <p>This is what Kestrel does with every request line it receives, and why an ASP.NET Core request
  does not allocate a string per header until something asks for one.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Byte-level work is only safe when the data is guaranteed ASCII. Measured on
    <code>"Zahlungsübersicht"u8</code>:</p>
    <pre data-lang="console"><code>     chars in the string : 17
     bytes in UTF-8      : 18

     IndexOf((byte)'b')  : 10
     string.IndexOf('b') : 9

     first 10 bytes decoded: "Zahlungsü"
     first  9 bytes decoded: "Zahlungs&amp;#65533;"</code></pre>
    <p>Byte offsets and character offsets are different numbers, and slicing at an arbitrary byte can
    cut a character in half and produce a replacement character. There is also no byte-level
    <code>ToUpper</code> that is correct outside ASCII.</p>
    <p><strong>Use byte-level parsing for formats that guarantee ASCII</strong> — HTTP methods, header
    names, numeric fields, currency codes, ISO dates. For anything a human typed, decode it properly.</p>
  </div>
</section>

<section id="production">
  <h2>The Ledger audit writer</h2>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="288 bytes per line, and two culture bugs"><code>long V1(Payment payment)
{
    // BUG 1: no culture. On a machine with a comma decimal separator this
    // writes "1234,50" into a file another system parses as two fields.
    // BUG 2: ToUpper allocates a string to throw away, and is culture
    // sensitive - the Turkish dotless i breaks currency codes containing 'i'.
    string line = $"{payment.Timestamp:O}|{payment.Id}|" +
                  $"{payment.Currency.ToUpper()}|{payment.AmountMinor / 100m:F2}|" +
                  $"{payment.Status}\n";

    byte[] bytes = Encoding.UTF8.GetBytes(line);
    return sink.Write(bytes);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="v3 - Utf8.TryWrite, 80 bytes per line"><code>long V3(Payment payment)
{
    Span&lt;byte&gt; buffer = stackalloc byte[128];

    // The enum is written as a u8 span rather than interpolated, because
    // interpolating an enum can call Enum.ToString(). Measured, this change
    // made no difference on this runtime - v3 stayed at exactly 80 bytes per
    // line. The 80 bytes are the three VALUE TYPE holes below, not the enum;
    // WhereV3sBytesGo above measures each one. The u8 form is kept because it
    // is correct regardless of what the runtime does with enum holes.
    ReadOnlySpan&lt;byte&gt; status = payment.Status switch
    {
        PaymentStatus.Settled =&gt; "Settled"u8,
        PaymentStatus.Pending =&gt; "Pending"u8,
        _ =&gt; "Held"u8
    };

    if (!Utf8.TryWrite(buffer, CultureInfo.InvariantCulture,
        $"{payment.Timestamp:O}|{payment.Id}|{payment.Currency}|{payment.AmountMinor / 100m:F2}|",
        out int written))
    {
        // A real writer falls back to a pooled buffer here rather than
        // silently truncating. Never ignore the false.
        throw new InvalidOperationException("audit line exceeded the buffer");
    }

    status.CopyTo(buffer[written..]);
    written += status.Length;
    buffer[written++] = (byte)'\n';

    return sink.Write(buffer[..written]);
}</code></pre>

  <h3>Why v3 stops at 80 rather than 0</h3>

  <p>This is worth its own measurement, because the answer is not in the source code:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   Why v3 is 80 bytes rather than 0 - one hole at a time:

   literal text only             0.0 B/call
   a string hole                 0.0 B/call
   a long hole                  24.0 B/call
   a DateTime hole, :O          24.0 B/call
   a decimal hole, :F2          32.0 B/call</code></pre>

  <p>Literals and string holes are free. <strong>Every value-type hole costs 24 to 32 bytes</strong>,
  and v3 has three of them: 24 + 24 + 32 = 80. The handler's generic
  <code>AppendFormatted&lt;T&gt;</code> performs a type test to find the fast formatting path, and on
  this runtime that boxes the value.</p>

  <p><code>Utf8Formatter.TryFormat</code>, which v4 calls directly, does not — and that is the entire
  remaining difference between them.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>This is not documented behaviour to rely on; it is what this runtime does, and it may change.
    The lesson is not "avoid <code>Utf8.TryWrite</code>" — it is that the last few bytes of an
    optimisation are frequently somewhere you would never find by reading.</p>
    <p>An earlier draft of this module recommended v3 while claiming it matched v4 on allocation. The
    measurement said otherwise.</p>
  </div>

  <h3>The recommendation</h3>

  <p><strong>Ship v3 in most services.</strong> It removes 71% of the allocation for a change that
  reads like the code it replaced. v4 is four times the code, hard-codes the field order, and puts
  position arithmetic in an audit path where a drift will not fail any test.</p>

  <p><strong>Ship v4 only if a measurement says the last 80 bytes matter.</strong></p>

  <p>And note where the biggest single step was: <strong>v1 to v2 was made for correctness</strong> —
  fixing the culture and removing <code>ToUpper</code> — and the allocation improvement came along for
  free.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Formatting without a culture</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Writes 1234,50 on a German machine"><code>// WRONG: no culture. This is a data-corruption bug in a pipe-delimited
// file, not a formatting preference.
string line = $"{payment.Id}|{payment.AmountMinor / 100m:F2}";</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Machine-readable output is always invariant"><code>string line = string.Create(CultureInfo.InvariantCulture,
    $"{payment.Id}|{payment.AmountMinor / 100m:F2}");</code></pre>

  <p>The rule: <strong>invariant culture for anything a machine will read</strong> — files, protocols,
  identifiers, logs. Current culture only for text shown to a person.</p>

  <h3>2. Case-insensitive comparison via <code>ToUpper</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Allocates, and fails in Turkish"><code>if (header.ToUpper() == "X-TENANT")
{
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Allocation-free and culture-independent"><code>if (string.Equals(header, "x-tenant", StringComparison.OrdinalIgnoreCase))
{
}</code></pre>

  <h3>3. An interpolated string passed to a logger</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Formats even when the level is disabled"><code>// WRONG: the string is built before the call. The logger cannot decline
// work that has already happened - measured, 500,000 strings built and
// discarded with logging switched off.
_logger.LogDebug($"settled {payment.Id} for {payment.AmountMinor / 100m:F2}");</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="A message template defers the formatting"><code>// The template and the arguments are passed separately, so nothing is
// formatted unless a sink is actually listening. This is why the
// ILogger API looks the way it does.
_logger.LogDebug("settled {PaymentId} for {Amount}",
    payment.Id, payment.AmountMinor / 100m);</code></pre>

  <p>Structured logging sinks also index those named holes, so the template form is better for
  querying as well as for allocation.</p>

  <h3>4. An interpolation hole with a side effect</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Runs in some environments and not others"><code>// WRONG with any handler that supports conditional evaluation. If the
// level is disabled the hole is never evaluated, so the counter does not
// advance - and the behaviour of the program depends on a log level.
_logger.LogDebug($"processed item {Interlocked.Increment(ref _counter)}");</code></pre>

  <h3>5. Slicing UTF-8 at an arbitrary offset</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Can cut a character in half"><code>// WRONG unless the content is guaranteed ASCII. Nine bytes into
// "Zahlungsübersicht"u8 lands in the middle of the u-umlaut, and
// decoding produces a replacement character.
ReadOnlySpan&lt;byte&gt; preview = body[..9];
string text = Encoding.UTF8.GetString(preview);</code></pre>

  <h3>6. Reaching for <code>string.Create</code> without an exact length</h3>

  <p>Measured: a version that guessed a length, padded, and called <code>TrimEnd</code> allocated
  <strong>168 bytes against interpolation's 112</strong> — worse than what it replaced. If the length
  cannot be computed cheaply and exactly, use interpolation.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> <code>System.String</code> at the top of an allocation profile, a
    high allocation rate with a flat heap, or garbled non-ASCII text in output.</p>
    <p><strong>Tools:</strong> <code>GC.GetTotalAllocatedBytes</code> around the operation, then a
    <code>gc-verbose</code> trace for the call sites, then the analysers.</p>
  </div>

  <h3>Step 1: measure bytes per operation, and assert on it</h3>

  <pre data-lang="csharp" data-net="10" data-title="An allocation budget test"><code>[Fact]
public void AuditLineAllocationDoesNotRegress()
{
    Payment payment = BuildPayment();

    for (int i = 0; i &lt; 1_000; i++)
    {
        AuditWriter.Write(payment);
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);

    const int iterations = 10_000;
    for (int i = 0; i &lt; iterations; i++)
    {
        AuditWriter.Write(payment);
    }

    long perLine = (GC.GetTotalAllocatedBytes(precise: true) - before) / iterations;

    Assert.True(perLine &lt;= 96, $"allocated {perLine} bytes per line, budget is 96");
}</code></pre>

  <p>The number is deterministic — unlike timing, which varied by a factor of two across runs of
  identical code throughout this track.</p>

  <h3>Step 2: find the strings</h3>

  <pre data-lang="bash"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime
dotnet-trace collect --process-id 4821 --profile gc-verbose</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>What you see</th><th>Usual cause</th></tr>
      </thead>
      <tbody>
        <tr><td>Many <code>System.String</code></td><td>Substrings, interpolation into logging, <code>ToUpper</code> comparisons</td></tr>
        <tr><td>Many <code>System.Byte[]</code> of similar size</td><td><code>Encoding.UTF8.GetBytes</code> per call</td></tr>
        <tr><td>Many <code>System.Char[]</code></td><td><code>StringBuilder</code> growth, or <code>ToCharArray</code></td></tr>
        <tr><td>Boxed primitives</td><td><code>string.Format</code>, <code>params object[]</code> logging</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Step 3: check the culture bugs while you are there</h3>

  <pre data-lang="bash" data-title="Run the suite under a culture that exposes them"><code>DOTNET_SYSTEM_GLOBALIZATION_PREDEFINED_CULTURES_ONLY=false \
  dotnet test -e LANG=tr-TR</code></pre>

  <p>Or force it in a test, which is more reliable than hoping CI runs somewhere unusual:</p>

  <pre data-lang="csharp" data-net="10"><code>[Fact]
public void HeaderMatchingIsCultureIndependent()
{
    CultureInfo original = CultureInfo.CurrentCulture;
    try
    {
        // Turkish: uppercasing 'i' does not produce 'I'.
        CultureInfo.CurrentCulture = new CultureInfo("tr-TR");

        Assert.True(HeaderMatcher.Matches("x-idempotency-key"));
    }
    finally
    {
        CultureInfo.CurrentCulture = original;
    }
}</code></pre>

  <h3>Step 4: let the analysers find the rest</h3>

  <pre data-lang="xml" data-title="Directory.Build.props"><code>&lt;PropertyGroup&gt;
  &lt;AnalysisMode&gt;Recommended&lt;/AnalysisMode&gt;

  &lt;!-- CA1305: an IFormatProvider is missing - the culture bugs above.
       CA1307/CA1310: a StringComparison is missing.
       CA1846: prefer AsSpan over Substring.
       CA1863: prefer CompositeFormat for repeated string.Format. --&gt;
  &lt;WarningsAsErrors&gt;$(WarningsAsErrors);CA1305;CA1307;CA1310;CA1846&lt;/WarningsAsErrors&gt;
&lt;/PropertyGroup&gt;</code></pre>

  <p><strong>CA1305 and CA1310 between them find every culture bug in this module</strong>, including
  the two in the Ledger writer. They are off by default because they are noisy on existing code — which
  is a reason to turn them on for new code, not a reason to leave them off.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A string of N characters takes N bytes."</strong></p>
    <p>It takes 22 + 2N, rounded up to a multiple of 8. <code>"GBP"</code> is 32 bytes for 3
    characters of information. Strings are UTF-16 in memory regardless of what the content could be
    encoded as.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Interpolation compiles to string.Format."</strong></p>
    <p>Not since C# 10. It compiles to <code>DefaultInterpolatedStringHandler</code>, which writes
    into a pooled buffer and does not box its arguments. Measured, interpolation allocated 104 bytes
    where <code>string.Format</code> allocated 128 and was slower.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"string.Create is always better than interpolation."</strong></p>
    <p>Only when interpolation is not already at the allocation floor. Measured on a cache key, both
    reached 56 bytes — the exact size of the resulting string — and <code>string.Create</code> was
    slower and fifteen lines longer.</p>
    <p>It pays when the alternative builds an <em>intermediate</em> string, not when the only
    allocation left is the answer itself.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Utf8.TryWrite is allocation-free."</strong></p>
    <p>Measured on .NET 10: literals and string holes are free, but every <em>value-type</em> hole
    costs 24 to 32 bytes, because the handler's generic <code>AppendFormatted</code> boxes the value
    when testing for the fast path.</p>
    <p>It is still a large improvement — 198 bytes to 80 in the Ledger writer — and it is not zero.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"ToUpper() and ToUpperInvariant() differ only in speed."</strong></p>
    <p><code>ToUpper()</code> uses the current culture and gives different answers on different
    machines — the Turkish dotless i is the classic. For comparison, neither is the right tool:
    <code>StringComparison.OrdinalIgnoreCase</code> is allocation-free and culture-independent.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"UTF-8 is always smaller than UTF-16."</strong></p>
    <p>Smaller for ASCII, the same for most Latin text with accents, and <em>larger</em> for some
    scripts. Measured, <code>"Ledger Zahlungsübersicht"</code> is 48 bytes as UTF-16 and 25 as UTF-8;
    the saving comes from the ASCII, not from the encoding being universally denser.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I can index UTF-8 bytes the way I index a string."</strong></p>
    <p>Byte offsets and character offsets are different numbers as soon as anything is non-ASCII —
    measured, byte index 10 against character index 9 for the same letter. And slicing at an arbitrary
    byte can cut a character in half, producing a replacement character rather than an error.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's audit writer produced 56-byte lines and allocated 288 bytes per line. At 5,000
    payments per second that is 1.4 MB/s and 4.9 GB an hour, causing 27 generation 0 collections in
    the measured window.</p>
    <p>After the rewrite: 80 bytes per line and 7 collections. Output identical, byte for byte —
    which the measurement checks, because a performance change that alters output is not a
    performance change.</p>
    <p>The two culture bugs fixed on the way were worth more than the allocation. A settlement file
    containing <code>1234,50</code> in a pipe-delimited amount field is a reconciliation incident, and
    it only happens on machines configured differently from the developers'.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Use</th></tr>
      </thead>
      <tbody>
        <tr><td>Comparing identifiers or header names</td><td><code>StringComparison.Ordinal</code> or <code>OrdinalIgnoreCase</code></td></tr>
        <tr><td>Sorting text a person reads</td><td>A culture-aware comparison, deliberately chosen</td></tr>
        <tr><td>Formatting for a file, protocol or log</td><td><code>CultureInfo.InvariantCulture</code>, always</td></tr>
        <tr><td>Building a string of computable exact length</td><td><code>string.Create</code></td></tr>
        <tr><td>Building a string, generally</td><td>Interpolation. It is already good.</td></tr>
        <tr><td>Writing a response body or log line</td><td><code>Utf8.TryWrite</code> into a stack or pooled span</td></tr>
        <tr><td>Fixed literals compared against bytes</td><td><code>u8</code> literals with <code>SequenceEqual</code></td></tr>
        <tr><td>Parsing numbers from bytes</td><td><code>Utf8Parser.TryParse</code></td></tr>
        <tr><td>A logging API you own</td><td>A custom interpolated string handler</td></tr>
        <tr><td>Extracting a field you will not keep</td><td><code>AsSpan</code>, never <code>Substring</code></td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>How many bytes does <code>"GBP"</code> occupy on the heap? And <code>"INV-2026-0004821"</code>?
    Give the formula.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>22 + 2N, rounded up to a multiple of 8.</strong></p>
        <pre data-lang="console"><code>   text                chars   on the heap   UTF-8 would be
   GBP                      3            32                3
   INV-2026-0004821        16            56               16
   OK                       2            32                2</code></pre>
        <p><code>"GBP"</code>: 22 + 6 = 28, rounded to <strong>32</strong>.
        <code>"INV-2026-0004821"</code>: 22 + 32 = 54, rounded to <strong>56</strong>.</p>
        <p>The 22 bytes are 8 for the sync block index, 8 for the method table pointer, 4 for the
        length field and 2 for a terminating null.</p>
        <p><strong>The consequence worth carrying:</strong> <code>"GBP"</code> costs ten times what
        the information in it does. A currency code held as a string in a hot loop is worth replacing
        with an enum or a <code>u8</code> literal — which is exactly what the parser in
        <code>05-exercises.cs</code> does.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Find two problems with this header check, and say which is worse.</p>
    <pre data-lang="csharp" data-net="10"><code>if (header.ToUpper() == "X-IDEMPOTENCY-KEY")
{
    return true;
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Problem 1: it allocates a string per call to throw away.</strong> Measured over a
        million calls:</p>
        <pre data-lang="console"><code>   ToUpper() ==                        40,000,912 B      53 ms
   string.Equals(OrdinalIgnoreCase)           912 B       7 ms</code></pre>
        <p><strong>Problem 2, and this is the worse one: it is incorrect.</strong>
        <code>ToUpper()</code> with no argument uses the current culture. In Turkish, uppercasing
        <code>i</code> produces a dotted capital I, not <code>I</code>.</p>
        <p>So on a machine with a Turkish locale, <code>"x-idempotency-key"</code> uppercases to
        something that does not equal <code>"X-IDEMPOTENCY-KEY"</code>, the header is never matched,
        and idempotency silently stops working. Every test passes, because the tests run in
        English.</p>
        <pre data-lang="csharp" data-net="10"><code>if (string.Equals(header, "x-idempotency-key", StringComparison.OrdinalIgnoreCase))
{
    return true;
}</code></pre>
        <p><strong>Why the allocation is the lesser problem:</strong> a performance bug is visible on
        a graph. This one is invisible until a customer in the wrong timezone reports duplicate
        charges.</p>
        <p>Analyser rules <strong>CA1307</strong> and <strong>CA1310</strong> catch it at build
        time.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Build a cache key of the form <code>tenant:currency:id</code> three ways and predict the
    allocation of each. Then say which you would ship.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console"><code>   approach                      allocated   per call     time
   concatenation                  48,000,376 B       96 B      24 ms
   interpolation                  28,001,448 B       56 B      60 ms
   string.Create, exact length    28,000,376 B       56 B     101 ms</code></pre>
        <p>The result is <code>"acme:GBP:4000821"</code> — 16 characters, so a 56-byte string.
        <strong>56 is therefore the floor</strong>: the caller wants a string and one has to exist.</p>
        <p><strong>Concatenation is 96 bytes</strong> because it formats the id into its own string
        first and then builds the result — two allocations for one answer.</p>
        <p><strong>Interpolation and <code>string.Create</code> both reach the floor.</strong>
        <code>string.Create</code> does not win, and it is slower and about fifteen lines longer.</p>
        <p><strong>Ship the interpolation.</strong> Once interpolation is at the minimum possible
        allocation there is nothing left for <code>string.Create</code> to remove. It pays only when
        the alternative would build an intermediate string.</p>
        <p>Note the trap in the <code>string.Create</code> version: computing the length must not
        itself allocate. Using <code>id.ToString().Length</code> would undo the whole exercise, which
        is measured elsewhere in this module at 112 bytes against interpolation's 104.</p>
        <p><strong>And the better answer to the underlying question:</strong> if the key exists only
        to look something up, do not build it at all. Use
        <code>dictionary.GetAlternateLookup&lt;ReadOnlySpan&lt;char&gt;&gt;()</code> from .NET 9 and
        allocate a string only on insert.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>This line allocates on every call even when debug logging is switched off. Explain exactly why,
    and give two fixes with their trade-offs.</p>
    <pre data-lang="csharp" data-net="10"><code>_logger.LogDebug($"settled {payment.Id} for {payment.AmountMinor / 100m:F2}");</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why:</strong> the parameter type is <code>string</code>. The interpolated string is
        built by the caller <em>before</em> <code>LogDebug</code> is entered, so the method cannot
        decline work that has already happened. Measured with logging disabled:</p>
        <pre data-lang="console"><code>   LogDebug($"...")  string parameter    76,000,912 B     500,000 formatted     123 ms
   if (IsEnabled) LogDebug($"...")               376 B           0 formatted       3 ms</code></pre>
        <p><strong>Fix 1: the guard.</strong></p>
        <pre data-lang="csharp" data-net="10"><code>if (_logger.IsEnabled(LogLevel.Debug))
{
    _logger.LogDebug($"settled {payment.Id} for {payment.AmountMinor / 100m:F2}");
}</code></pre>
        <p>Correct, and three extra lines at every call site — which is precisely why it is so often
        missing.</p>
        <p><strong>Fix 2: the message template overload</strong>, which is what
        <code>Microsoft.Extensions.Logging</code> is designed around:</p>
        <pre data-lang="csharp" data-net="10"><code>_logger.LogDebug("settled {PaymentId} for {Amount}",
    payment.Id, payment.AmountMinor / 100m);</code></pre>
        <p>The template and the arguments are separate, so nothing is formatted unless a sink is
        listening. Structured sinks also index the named holes, so this is better for querying as
        well. <strong>The trade-off is boxing</strong> — the arguments go through
        <code>params object[]</code> — which for a disabled level is far cheaper than formatting, and
        for an enabled one is a real cost. <code>LoggerMessage.Define</code> removes even that.</p>
        <p><strong>Fix 3, if you own the logging API:</strong> a custom interpolated string handler.
        Measured, 500,000 disabled calls formatted <strong>0</strong> values and allocated 376 bytes
        in total, with no guard at the call site.</p>
        <p><strong>The caveat that comes with fix 3:</strong> the arguments are not evaluated at all
        when the level is disabled. That is the point, and it makes any hole with a side effect a
        bug whose behaviour depends on a log level.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Write a custom interpolated string handler for a logger, so callers need no
    <code>IsEnabled</code> guard. Then state the two things a reviewer must check about every call
    site that uses it.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>Three pieces are required: the attribute, a constructor with
        <code>(literalLength, formattedCount)</code> plus whatever context you need, and the
        <code>Append</code> methods.</p>
        <pre data-lang="csharp" data-net="10"><code>using System.Runtime.CompilerServices;

public sealed class AuditLogger
{
    public bool IsDebugEnabled { get; set; }

    // The handler as the parameter type is what makes this work. The
    // attribute tells the compiler to pass the receiver ("") to the
    // handler's constructor.
    public void LogDebug([InterpolatedStringHandlerArgument("")] ref DebugLogHandler handler)
    {
        if (!IsDebugEnabled)
        {
            return;
        }

        Write(handler.ToStringAndClear());
    }

    private static void Write(string line)
    {
        Console.WriteLine(line);
    }
}

[InterpolatedStringHandler]
public ref struct DebugLogHandler
{
    private DefaultInterpolatedStringHandler _inner;
    private readonly bool _enabled;

    // The out bool is the mechanism. Returning false tells the COMPILER to
    // skip every append - and to skip evaluating the arguments.
    public DebugLogHandler(int literalLength, int formattedCount, AuditLogger logger,
        out bool shouldAppend)
    {
        _enabled = logger.IsDebugEnabled;
        shouldAppend = _enabled;

        _inner = _enabled
            ? new DefaultInterpolatedStringHandler(literalLength, formattedCount)
            : default;
    }

    public void AppendLiteral(string value)
    {
        if (_enabled)
        {
            _inner.AppendLiteral(value);
        }
    }

    public void AppendFormatted&lt;T&gt;(T value)
    {
        if (_enabled)
        {
            _inner.AppendFormatted(value);
        }
    }

    public void AppendFormatted&lt;T&gt;(T value, string? format)
    {
        if (_enabled)
        {
            _inner.AppendFormatted(value, format);
        }
    }

    public string ToStringAndClear() =&gt; _enabled ? _inner.ToStringAndClear() : string.Empty;
}</code></pre>
        <p>Measured with logging disabled and no guard at the call site:</p>
        <pre data-lang="console"><code>   LogDebug($"...")  custom handler             376 B           0 formatted      16 ms
   the same, logging ENABLED              76,000,912 B   2,000,000 formatted     148 ms</code></pre>
        <p><strong>The two things a reviewer must check at every call site:</strong></p>
        <ol>
          <li><strong>No side effects in any hole.</strong> The expressions are not evaluated when the
          level is disabled — verified, a side-effecting argument ran 0 times with logging off and 1
          time with it on. An <code>Interlocked.Increment</code> or an enumerator advance inside a
          hole becomes a bug whose behaviour depends on configuration.</li>
          <li><strong>No exceptions from a hole.</strong> A property that can throw will throw only
          when the level is enabled — so a crash appears the moment somebody turns on debug logging
          in production, which is exactly when they are already investigating something else.</li>
        </ol>
        <p><strong>One design note:</strong> the handler is a <code>ref struct</code>, so it lives on
        the stack and cannot escape. That is deliberate — it holds a
        <code>DefaultInterpolatedStringHandler</code>, which itself holds a pooled buffer that must be
        returned by <code>ToStringAndClear</code>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Ledger's audit writer produces a 56-byte line and allocates 288 bytes doing it. Take it down,
    step by step, and say where you would stop and why.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console"><code>   version                          allocated    per line    gen0     time   bytes
   v1 interpolation + GetBytes      86,284,008 B       288 B     27     337 ms      56
   v2 culture fixed, ToUpper gone   59,283,352 B       198 B     18     286 ms      56
   v3 Utf8.TryWrite into stack      24,000,376 B        80 B      7     189 ms      56
   v4 hand-written UTF-8                   376 B         0 B      0     110 ms      56</code></pre>
        <p><strong>Step 1 is not a performance change at all.</strong> The original has no culture and
        calls <code>ToUpper()</code> on a currency code. Both are correctness bugs — a comma decimal
        separator corrupts a pipe-delimited file, and the Turkish dotless i breaks matching. Fixing
        them takes 288 bytes to 198 as a side effect.</p>
        <pre data-lang="csharp" data-net="10"><code>string line = string.Create(CultureInfo.InvariantCulture,
    $"{payment.Timestamp:O}|{payment.Id}|{payment.Currency}|{payment.AmountMinor / 100m:F2}|{payment.Status}\n");</code></pre>
        <p><strong>Step 2 removes the intermediate UTF-16 string</strong> with
        <code>Utf8.TryWrite</code>, which writes UTF-8 straight into a stack span. 198 bytes to 80,
        and it reads almost identically to the version it replaces.</p>
        <p><strong>Where the last 80 bytes are</strong>, measured hole by hole:</p>
        <pre data-lang="console"><code>   literal text only             0.0 B/call
   a string hole                 0.0 B/call
   a long hole                  24.0 B/call
   a DateTime hole, :O          24.0 B/call
   a decimal hole, :F2          32.0 B/call</code></pre>
        <p>Three value-type holes: 24 + 24 + 32 = 80. The handler's generic
        <code>AppendFormatted&lt;T&gt;</code> boxes the value while testing for the fast formatting
        path. That is a property of the runtime, not of the code.</p>
        <p><strong>Where I would stop: v3.</strong> 71% of the allocation removed for a change that
        reads like the code it replaced, and 27 generation 0 collections down to 7.</p>
        <p><strong>Why not v4:</strong> it is four times the code, it hard-codes the field order, and
        a new field means editing position arithmetic in the audit path — where a drift produces a
        subtly malformed audit record that no test will catch, because the tests check the fields they
        know about.</p>
        <p><strong>What would change my mind:</strong> a measurement showing this path dominating the
        service's allocation, and a reviewer's confidence that the byte arithmetic will be maintained.
        Both, not either.</p>
        <p><strong>A note on method:</strong> an earlier draft of this recommended v3 while claiming
        it matched v4 on allocation. It does not, and nothing in the source code would have revealed
        that. The hole-by-hole measurement is what settled it.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>How many bytes does a 16-character string occupy?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>56. The formula is 22 bytes of overhead plus 2 per character
        (strings are UTF-16), rounded up to a multiple of 8.</p></div>
      </details></li>

    <li><p>Which of <code>Trim</code>, <code>ToUpper</code>, <code>Substring</code> and
      <code>ToString</code> allocate?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The first three always do — strings are immutable, so every
        "mutation" returns a new one. <code>ToString()</code> on a string returns the same
        instance.</p>
        <p><code>ToUpperInvariant</code> also returns the input when there was nothing to change,
        which makes it read as free on already-uppercase test data.</p></div>
      </details></li>

    <li><p>What does interpolation compile to in modern C#?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>DefaultInterpolatedStringHandler</code> — a sequence of
        <code>AppendLiteral</code>/<code>AppendFormatted</code> calls into a pooled buffer, then
        <code>ToStringAndClear</code>. Not <code>string.Format</code>, and
        <code>AppendFormatted</code> is generic so arguments are not boxed.</p></div>
      </details></li>

    <li><p>Why does <code>logger.LogDebug($"...")</code> allocate when debug logging is off?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The parameter is a <code>string</code>, so the caller builds it
        before the method is entered. The method cannot decline work already done — measured, 500,000
        strings built and discarded with logging disabled.</p></div>
      </details></li>

    <li><p>What are the three requirements for a custom interpolated string handler?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The <code>[InterpolatedStringHandler]</code> attribute; a
        constructor taking <code>(int literalLength, int formattedCount)</code>; and
        <code>AppendLiteral</code>/<code>AppendFormatted</code> methods.</p>
        <p>For conditional evaluation, add an <code>out bool</code> to the constructor and
        <code>[InterpolatedStringHandlerArgument("")]</code> on the parameter.</p></div>
      </details></li>

    <li><p>What is the trap in conditional evaluation?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The expressions inside the holes are <strong>not evaluated</strong>
        when the handler declines — verified, a side-effecting argument ran 0 times with logging off
        and 1 time with it on.</p>
        <p>An interpolation hole must be a pure expression, or the program's behaviour depends on a
        log level.</p></div>
      </details></li>

    <li><p>What is a <code>u8</code> literal, and what does it cost?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A <code>ReadOnlySpan&lt;byte&gt;</code> of UTF-8 bytes baked into
        the assembly at compile time. Nothing at runtime — measured against
        <code>Encoding.UTF8.GetBytes("GBP")</code>, which allocated 64 MB over two million calls where
        the literal allocated 912 bytes in total.</p></div>
      </details></li>

    <li><p>Is <code>Utf8.TryWrite</code> allocation-free?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. Literals and string holes are free; every value-type hole
        costs 24 to 32 bytes on .NET 10, because the handler's generic
        <code>AppendFormatted</code> boxes while testing for the fast path.</p>
        <p>It is still a large improvement — 198 bytes per line to 80 in the measured writer — and it
        is not zero.</p></div>
      </details></li>

    <li><p>Why is <code>header.ToUpper() == "X-TENANT"</code> a correctness bug as well as an
      allocation?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>ToUpper()</code> uses the current culture. In Turkish,
        uppercasing <code>i</code> does not produce <code>I</code>, so a header containing an
        <code>i</code> stops matching on a Turkish machine and matches everywhere the tests run.</p>
        <p>Use <code>StringComparison.OrdinalIgnoreCase</code>: allocation-free and
        culture-independent.</p></div>
      </details></li>

    <li><p>When is it safe to slice UTF-8 bytes at an arbitrary offset?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Only when the content is guaranteed ASCII. Measured on
        <code>"Zahlungsübersicht"u8</code>, byte index 10 corresponds to character index 9, and
        slicing at 9 bytes cuts the u-umlaut in half and decodes to a replacement character — with no
        exception.</p>
        <p>Byte-level parsing is for formats that guarantee ASCII: HTTP methods, header names, numeric
        fields, currency codes, ISO dates.</p></div>
      </details></li>
  </ol>
</section>
`
});
