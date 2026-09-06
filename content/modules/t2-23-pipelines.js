CSPREP.module({
  id: "t2-23-pipelines",
  minutes: 55,
  updated: "2026-09-02",
  summary: "TCP delivers bytes, not messages, and a parser that treats each read as whole records finds the right COUNT of records with every one corrupt - which is why it passes its tests. A Pipe keeps the unconsumed bytes for you, and its one unfamiliar concept, consumed versus examined, is what decides between a working reader, a hot spin loop measured at over a million empty reads in 200 ms, and a hang. But the honest measurement matters: against a correct hand-written stream parser reading from memory, the pipe was 3x to 10x SLOWER. A pipe is a correctness and back-pressure tool, not a throughput optimisation.",
  terms: ["framing", "message boundary", "System.IO.Pipelines", "Pipe", "PipeWriter",
    "PipeReader", "GetMemory", "Advance", "FlushAsync", "AdvanceTo", "consumed", "examined",
    "ReadOnlySequence", "segment", "SequenceReader", "SequencePosition", "back pressure",
    "pauseWriterThreshold", "hysteresis", "maximum message size"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger receives a live feed from each partner bank over a TCP connection. The records are
  newline-delimited:</p>

  <pre data-lang="text"><code>INV-2026-0000001|GBP|123450
INV-2026-0000002|EUR|998877
INV-2026-0000003|USD|000042</code></pre>

  <p>The reader was the obvious code: read a chunk, find the newlines in it, parse what is between
  them. It ran for eighteen months.</p>

  <p>Then a partner upgraded their sender and the records started arriving in differently sized TCP
  segments. Here is what the original reader produced, given exactly the same three records delivered
  in 20-byte chunks:</p>

  <pre data-lang="console" data-title="01-why-streams-are-hard.cs"><code>   records sent  : 3
   records found : 3
     "|123450"
     "0002|EUR|998877"
     "042"</code></pre>

  <p><strong>Read the count line before the records.</strong> Three sent, three found. A test that
  asserts on the number of records passes. Every single one is corrupt.</p>

  <p>The cause is that TCP delivers <em>bytes</em>. It has no idea where your records begin or end. One
  read can return half a record, one record, two and a half records, or a single byte — and the
  original reader threw away whatever was left at the end of each chunk.</p>

  <p>Turning a byte stream back into messages is called <strong>framing</strong>, and doing it
  correctly by hand is a specific, well-known category of bug. <code>System.IO.Pipelines</code> exists
  to do it once, in the library, instead of in every parser.</p>

  <p>This module is about that library, the one concept in it that has no equivalent in
  <code>Stream</code> — and an honest measurement showing that a pipe is <em>slower</em> than a good
  hand-written parser, which is not what the usual pitch suggests and changes when you should reach
  for one.</p>
</section>

<section id="plain-language">
  <h2>Framing, and why a Stream cannot help</h2>

  <p class="define"><span class="define__term">Framing</span> Recovering message boundaries from a
  stream of bytes that has none. Every network protocol needs it, and there are only three ways to do
  it: a delimiter, a length prefix, or a fixed size.</p>

  <p class="define"><span class="define__term">Partial message</span> Bytes that have arrived but do
  not yet form a complete message. Something must hold them until the rest arrives, and deciding what
  that something is is the whole problem.</p>

  <p class="define"><span class="define__term">Back pressure</span> A way for a slow consumer to make a
  fast producer wait. Without it, a producer that outruns its consumer grows a buffer until the process
  dies.</p>

  <p>The hand-written fix is straightforward to describe and easy to get wrong: keep an accumulator,
  append each read to it, extract every complete record, shuffle the remainder to the front.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-why-streams-are-hard.cs"><code>static void GrowingBufferParser()
{
    Console.WriteLine("3. The usual fix - accumulate into a growing buffer");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes(
        "INV-2026-0000001|GBP|123450\n" +
        "INV-2026-0000002|EUR|998877\n" +
        "INV-2026-0000003|USD|000042\n");

    using var stream = new SplittingStream(payload, chunkSize: 20);

    var accumulator = new byte[64];
    int accumulated = 0;
    int resizes = 0;
    int copies = 0;
    var found = new List&lt;string&gt;();

    var readBuffer = new byte[20];
    int read;

    while ((read = stream.Read(readBuffer, 0, readBuffer.Length)) &gt; 0)
    {
        // Grow if the new data does not fit.
        if (accumulated + read &gt; accumulator.Length)
        {
            Array.Resize(ref accumulator, accumulator.Length * 2);
            resizes++;
        }

        Array.Copy(readBuffer, 0, accumulator, accumulated, read);
        copies++;
        accumulated += read;

        // Consume every complete record currently buffered.
        int start = 0;
        while (true)
        {
            int newline = Array.IndexOf(accumulator, (byte)'\n', start, accumulated - start);
            if (newline &lt; 0)
            {
                break;
            }

            found.Add(Encoding.UTF8.GetString(accumulator, start, newline - start));
            start = newline + 1;
        }

        // Shuffle the unconsumed remainder to the front.
        if (start &gt; 0)
        {
            Array.Copy(accumulator, start, accumulator, 0, accumulated - start);
            copies++;
            accumulated -= start;
        }
    }

    Console.WriteLine($"   records found : {found.Count}");
    foreach (string record in found)</code></pre>

  <pre data-lang="console" data-title="01-why-streams-are-hard.cs"><code>   records found : 3
     "INV-2026-0000001|GBP|123450"
     "INV-2026-0000002|EUR|998877"
     "INV-2026-0000003|USD|000042"

   buffer resizes: 0
   memory copies : 8</code></pre>

  <p>That is correct. It also has four separate concerns tangled together — reading, growing a buffer,
  copying the remainder, and finding boundaries — and every byte that straddles a boundary is copied
  at least twice.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Notice the resize count is <strong>zero</strong>. The initial 64-byte buffer happened to be
    large enough for this input, so the growth path — the part most likely to be wrong — never ran.</p>
    <p>That is how this code ships: the hard branch is not exercised by the data anyone tested with.</p>
  </div>

  <h3>What the hand-written version still does not handle</h3>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Problem</th><th>What it takes to fix by hand</th></tr>
      </thead>
      <tbody>
        <tr><td>A client that never sends a delimiter</td><td>The accumulator doubles forever — an unbounded allocation, which is a denial of service. Needs a maximum threaded through the loop.</td></tr>
        <tr><td>Records arriving faster than they are processed</td><td>Nothing tells the reader to slow down. A <code>Stream</code> has no way to express it.</td></tr>
        <tr><td>Buffer reuse across connections</td><td>One array per connection. At 10,000 connections that is 10,000 buffers.</td></tr>
        <tr><td>The copy itself</td><td>Nothing. Shuffling the remainder is pure overhead — the bytes have not changed, only their address.</td></tr>
      </tbody>
    </table>
  </div>

  <p class="define"><span class="define__term">Delimiter framing</span> Recovering messages
  by looking for a separator - a newline, a null byte, a CRLF pair. Simple, and it requires the
  separator never to appear inside a message.</p>

  <p class="define"><span class="define__term">Length-prefix framing</span> Recovering messages by
  reading a fixed-size header that says how long the body is. It handles arbitrary content, and it
  needs a maximum or a hostile length prefix becomes an unbounded allocation.</p>

  <p class="define"><span class="define__term">Segment</span> One contiguous block inside a
  <code>ReadOnlySequence</code>. A pipe hands out pooled memory in blocks, so a message spanning two
  blocks arrives as two segments and is not contiguous.</p>

  <p><strong>An analogy, and its limits.</strong> A stream is a letterbox: post arrives in whatever
  bundles the postman happened to carry, and a letter can be split across two deliveries. A pipe is a
  letterbox with a shelf attached — anything you have not finished reading stays on the shelf, and the
  shelf is not yours to manage.</p>

  <p><strong>Where the analogy breaks:</strong> you would notice a half-letter. A parser cannot tell
  "the message is incomplete" from "the message is malformed" unless it is written to, and the shelf
  only works if you tell it accurately what you took and what you looked at. Getting that second part
  wrong is the subject of most of this module.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — A pipe keeps the bytes you did not consume, so a
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
    ReadOnlySequence&lt;byte&gt; record = result.Buffer.Slice(0, newline.Value);
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
    Memory&lt;byte&gt; memory = writer.GetMemory(text.Length);
    int written = Encoding.UTF8.GetBytes(text, memory.Span);
    writer.Advance(written);
    await writer.FlushAsync();
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>read 1: 20 bytes, no newline yet
read 2: 28 bytes - the earlier bytes were kept
record: "INV-2026-0000001|GBP|123450"

No buffer was allocated, resized, or copied by this code. The pipe held
the 20 unconsumed bytes and delivered 28 on the next read.</code></pre>

  <p>That is the entire framing problem from the previous section, solved by the library. The 20 bytes
  from the first read were kept and redelivered with the rest, and this code contains no accumulator,
  no resize and no copy.</p>
</section>

<section id="anatomy">
  <h2>What a Pipe is</h2>

  <p class="define"><span class="define__term">Pipe</span> A buffer with two ends and a pool of memory
  it owns. A <code>PipeWriter</code> puts bytes in; a <code>PipeReader</code> takes them out; the pipe
  keeps whatever the reader has not consumed.</p>

  <p class="define"><span class="define__term">PipeWriter</span> <code>GetMemory</code> to obtain a
  buffer <em>from the pipe</em>, <code>Advance</code> to say how much of it you filled,
  <code>FlushAsync</code> to publish it.</p>

  <p class="define"><span class="define__term">PipeReader</span> <code>ReadAsync</code> to get
  everything currently buffered, <code>AdvanceTo</code> to say what you did with it.</p>

  <p>The inversion is the point: <strong>the writer asks the pipe for memory rather than supplying its
  own</strong>, so the buffer belongs to the pipe, is pooled, and is reused across reads and across
  connections.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-pipe-basics.cs"><code>static async Task BasicRoundTrip()
{
    Console.WriteLine("2. Writing and reading");
    Console.WriteLine();

    var pipe = new Pipe();

    // --- the writer side ---------------------------------------------------
    Memory&lt;byte&gt; memory = pipe.Writer.GetMemory(64);
    int written = Encoding.UTF8.GetBytes("INV-2026-0000001|GBP|123450\n", memory.Span);

    // Advance tells the pipe how much of that memory you actually filled.
    // Getting this wrong publishes uninitialised bytes.
    pipe.Writer.Advance(written);
    await pipe.Writer.FlushAsync();
    await pipe.Writer.CompleteAsync();

    // --- the reader side ---------------------------------------------------
    ReadResult result = await pipe.Reader.ReadAsync();
    ReadOnlySequence&lt;byte&gt; buffer = result.Buffer;

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
// 3. The concept Stream does not have.</code></pre>

  <pre data-lang="console" data-title="02-pipe-basics.cs"><code>   bytes written      : 28
   sequence length    : 28
   IsSingleSegment    : True
   IsCompleted        : True
   content            : "INV-2026-0000001|GBP|123450"</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>GetMemory(64)</code> asks for <strong>at least</strong> 64 bytes and usually returns more
    — the same rule as <code>ArrayPool.Rent</code>. Never assume the returned span is the size you
    asked for.</p>
    <p>And <code>Advance</code> must be told how much you actually filled. Advancing further than you
    wrote publishes uninitialised bytes from the pool, which is a data-disclosure bug of exactly the
    kind seen in the pooling module.</p>
  </div>
</section>

<section id="consumed-examined">
  <h2><code>consumed</code> versus <code>examined</code></h2>

  <p>This is the one concept with no equivalent in <code>Stream</code>, and it is where pipe readers go
  wrong.</p>

  <p class="define"><span class="define__term">consumed</span> The position up to which you are
  finished with the data. The pipe may discard everything before it and reuse that memory.</p>

  <p class="define"><span class="define__term">examined</span> The position up to which you have
  <em>looked</em>. The pipe will not complete another <code>ReadAsync</code> until there is data
  <strong>past</strong> this point.</p>

  <p>They are different because "I could not use this yet" and "I have not seen this yet" are different
  statements, and the pipe needs both to know whether to wake you.</p>

  <pre data-lang="csharp" data-net="10" data-title="The correct call when a record is incomplete"><code>ReadResult result = await reader.ReadAsync();
ReadOnlySequence&lt;byte&gt; buffer = result.Buffer;

while (TryReadRecord(ref buffer, out ReadOnlySequence&lt;byte&gt; record))
{
    Process(record);
}

// consumed = everything framed. examined = buffer.End, because the
// remainder was scanned and contained no delimiter.
reader.AdvanceTo(buffer.Start, buffer.End);</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th><code>AdvanceTo</code> call</th><th>Meaning</th><th>Result</th></tr>
      </thead>
      <tbody>
        <tr><td><code>(consumed, buffer.End)</code></td><td>Used what I could, looked at all of it</td><td><strong>Correct.</strong> Waits for more data.</td></tr>
        <tr><td><code>(consumed, consumed)</code></td><td>Used what I could, looked at no more</td><td><strong>Hot spin.</strong> Returns immediately, forever.</td></tr>
        <tr><td><code>(buffer.Start, buffer.End)</code></td><td>Used nothing, looked at everything</td><td>Correct when no record was complete.</td></tr>
        <tr><td><code>examined</code> past what arrived</td><td>Looked beyond the data</td><td><strong>Hang.</strong> <code>ReadAsync</code> never completes.</td></tr>
      </tbody>
    </table>
  </div>

  <h3>The spin, measured</h3>

  <pre data-lang="console" data-title="02-pipe-basics.cs"><code>4. WRONG - examined set to consumed when a message is incomplete

   read 1: 20 bytes, still no newline
   spins in 200 ms : 1,063,104</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Over a million reads in 200 milliseconds, every one returning the same 20 bytes with no
    delimiter. This is a core pinned at 100% on a connection making no progress.</p>
    <p>In production it looks like high CPU with no throughput, and it scales with the number of
    connections in that state — so a handful of clients that paused mid-message can saturate the
    machine.</p>
    <p>The opposite mistake is quieter and harder to find: <code>examined</code> set past what has
    arrived means <code>ReadAsync</code> never completes and the connection hangs until it times
    out.</p>
  </div>

  <p><strong>The rule: <code>examined</code> is where you stopped looking.</strong> If you scanned the
  whole buffer for a delimiter and did not find one, <code>examined</code> is <code>buffer.End</code>.
  That is the single most important line in a pipe reader.</p>

  <p>The single-argument <code>AdvanceTo(consumed)</code> sets <code>examined</code> equal to
  <code>consumed</code>. Use it only when you consumed everything you looked at.</p>
</section>

<section id="sequences">
  <h2><code>ReadOnlySequence</code> is not contiguous</h2>

  <p class="define"><span class="define__term">ReadOnlySequence&lt;T&gt;</span> A view over one or more
  blocks of memory. A pipe hands you memory it took from a pool in blocks, so a message spanning two
  blocks arrives as two segments — and the pipe deliberately does <em>not</em> copy them together,
  because that copy is what it exists to avoid.</p>

  <pre data-lang="console" data-title="03-sequencereader.cs"><code>   one block   : length  27, IsSingleSegment True
   four blocks : length  27, IsSingleSegment False

   the second one, block by block:
     [INV-2026]
     [-0000001]
     [|GBP|123]
     [450]</code></pre>

  <h3>The mistake this creates</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Searches the first block only"><code>// FirstSpan is the FIRST BLOCK, not the whole sequence.
int newline = buffer.FirstSpan.IndexOf((byte)'\n');
if (newline &lt; 0)
{
    return false;      // "incomplete" - forever
}</code></pre>

  <pre data-lang="console" data-title="03-sequencereader.cs"><code>   sequence length : 27
   FirstSpan length: 8
   IndexOf('|')    : -1  (not found)</code></pre>

  <p>The delimiter is at offset 16, in the third block. The parser concludes the message is incomplete
  and waits forever <strong>for data that has already arrived</strong>.</p>

  <p>Against a small payload the sequence is a single segment and this code is correct. It breaks under
  load, when messages start spanning pooled blocks — which is exactly when you least want a new failure
  mode.</p>

  <h3><code>SequenceReader</code> does the walking</h3>

  <p class="define"><span class="define__term">SequenceReader&lt;T&gt;</span> A cursor over a
  <code>ReadOnlySequence&lt;T&gt;</code> that crosses segment boundaries for you.
  <code>TryReadTo</code> finds a delimiter, <code>TryRead</code> takes one item,
  <code>TryReadExact</code> takes a count, and each returns <code>false</code> when there is not enough
  data — which is the signal to wait.</p>

  <pre data-lang="csharp" data-net="10"><code>var reader = new SequenceReader&lt;byte&gt;(buffer);

if (reader.TryReadTo(out ReadOnlySequence&lt;byte&gt; invoice, (byte)'|') &amp;&amp;
    reader.TryReadTo(out ReadOnlySequence&lt;byte&gt; currency, (byte)'|') &amp;&amp;
    reader.TryReadTo(out ReadOnlySequence&lt;byte&gt; amount, (byte)'\n'))
{
    Process(invoice, currency, amount);
}</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>A <strong>multi-byte delimiter can be split across a block boundary.</strong> Measured, with
    <code>\r</code> ending one block and <code>\n</code> starting the next:</p>
    <pre data-lang="console"><code>   per-segment span search found it : False
   SequenceReader found it          : True</code></pre>
    <p>A parser that loops over segments and searches each one separately misses the delimiter
    entirely, then waits forever. It is the hardest version of this bug to reproduce, because it needs
    the split to land on exactly the wrong byte.</p>
  </div>

  <h3>The fast path</h3>

  <pre data-lang="console" data-title="03-sequencereader.cs"><code>   approach                              sequence      time
   FirstSpan.IndexOf (fast path)         one block      18 ms
   SequenceReader.TryReadTo              one block     106 ms
   SequenceReader.TryReadTo            four blocks     229 ms</code></pre>

  <p>Most reads <em>are</em> a single segment, because a message usually fits in one pooled block. The
  standard shape is worth 5.9x on that common case:</p>

  <pre data-lang="csharp" data-net="10"><code>static long FindDelimiter(ReadOnlySequence&lt;byte&gt; buffer)
{
    // Vectorised span search when the data is contiguous, which is most reads.
    if (buffer.IsSingleSegment)
    {
        return buffer.FirstSpan.IndexOf((byte)'\n');
    }

    var reader = new SequenceReader&lt;byte&gt;(buffer);
    return reader.TryReadTo(out ReadOnlySequence&lt;byte&gt; line, (byte)'\n') ? line.Length : -1;
}</code></pre>

  <p><strong>Write the general path first and test it with a fragmented sequence, then add the fast
  path.</strong> A fast path added to a correct parser is an optimisation; a fast path that is the only
  path is the bug above.</p>
</section>

<section id="back-pressure">
  <h2>Back pressure</h2>

  <p><code>FlushAsync</code> is the signal. When the pipe holds more than
  <code>pauseWriterThreshold</code>, it does not complete until the reader has drained below
  <code>resumeWriterThreshold</code>.</p>

  <pre data-lang="console" data-title="02-pipe-basics.cs"><code>   after 1024 bytes: FlushAsync did NOT complete
   the writer is now waiting for the reader

   reader drained 1024 bytes, flush completed</code></pre>

  <p>Measured with the same producer and consumer at two thresholds:</p>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   pauseWriterThreshold 1 MB  : pipe grew to 102,400 bytes
   pauseWriterThreshold 4 KB  : pipe held at   4,096 bytes</code></pre>

  <p>Same code, same load. The threshold decides how much unread data may accumulate, and therefore how
  much memory a slow consumer can cost you.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Always await <code>FlushAsync</code>.</strong> Discarding it does not skip the back
    pressure — it breaks the pipe. Calling <code>FlushAsync</code> again while a previous flush is
    pending throws <code>InvalidOperationException</code>, which is how the first draft of this
    module's own exercise crashed.</p>
    <p>And check <code>FlushResult.IsCompleted</code>: it means the <em>reader</em> is gone, and
    continuing to write is work nobody will read.</p>
  </div>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The two thresholds differ on purpose. A single value would make the writer stop and start on
    every byte at the boundary; the gap between them is hysteresis.</p>
    <p>Defaults are 64 KB pause and 32 KB resume. A <code>Stream</code> has no equivalent of any of
    this — <code>WriteAsync</code> completes when the bytes are accepted.</p>
  </div>

  <h3>Bounding a message costs nothing</h3>

  <pre data-lang="csharp" data-net="10"><code>// buffer.Length is known without copying or walking segments, so this
// check is affordable on every read.
if (buffer.Length &gt; MaxRecordBytes)
{
    _logger.LogWarning("Rejecting connection: {Bytes} bytes with no delimiter", buffer.Length);
    reader.AdvanceTo(buffer.Start, buffer.End);
    return;
}</code></pre>

  <pre data-lang="console" data-title="04-production.cs"><code>   hostile client sent 10,000 bytes with no delimiter
   outcome : rejected at 10000 bytes (limit 256)</code></pre>

  <p>The hand-written accumulator has no equivalent: it doubles until the process dies, and adding a
  limit means threading a maximum through the read loop by hand.</p>
</section>

<section id="production">
  <h2>The Ledger feed reader, measured honestly</h2>

  <pre data-lang="csharp" data-net="10" data-title="The pipe reader, end to end"><code>        }

        await writer.CompleteAsync().ConfigureAwait(false);
    }

    static async Task&lt;(int, long)&gt; ReadPipeAsync(PipeReader reader)
    {
        int count = 0;
        long checksum = 0;

        while (true)
        {
            ReadResult result = await reader.ReadAsync().ConfigureAwait(false);
            ReadOnlySequence&lt;byte&gt; buffer = result.Buffer;

            while (TryReadRecord(ref buffer, out ReadOnlySequence&lt;byte&gt; record))
            {
                checksum += ParseAmountSequence(record);
                count++;
            }

            // consumed = everything framed. examined = buffer.End, because the
            // remainder was scanned and contained no newline. Setting examined
            // to consumed here is the spin bug from 02-pipe-basics.cs.
            reader.AdvanceTo(buffer.Start, buffer.End);

            if (result.IsCompleted)
            {
                break;
            }
        }

        await reader.CompleteAsync().ConfigureAwait(false);
        return (count, checksum);
    }
}</code></pre>

  <pre data-lang="console" data-title="04-production.cs"><code>   chunk    reader           records    checksum   allocated       time
   -----    ------           -------    --------   ---------       ----
      64    stream            200,000   109830000       0.0 MB        8 ms
      64    pipe              200,000   109830000       0.0 MB       30 ms

    4096    stream            200,000   109830000       0.0 MB        5 ms
    4096    pipe              200,000   109830000       0.0 MB       35 ms

   65536    stream            200,000   109830000       0.3 MB        5 ms
   65536    pipe              200,000   109830000       0.2 MB       26 ms</code></pre>

  <p>First, the check that matters: both readers agree on the record count and the checksum at every
  chunk size, including 64 bytes. A faster parser that reads different data is not a faster parser.</p>

  <p>Now the uncomfortable part. <strong>The pipe is three to seven times slower here, and both
  allocate about the same — which is to say almost nothing.</strong></p>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Pipelines are the fast way to parse."</strong></p>
    <p>Not against a <em>correct, tuned</em> stream parser reading from memory. The hand-written
    version here reuses one accumulator, parses with spans and never materialises a string. The pipe
    adds async machinery and wins nothing back.</p>
    <p>The comparison flatters the stream in one specific way: the source is an in-memory array. Over a
    real socket the I/O dominates and this overhead disappears. Read these numbers as a verdict on
    pipes as a <em>throughput optimisation</em> — which is not what they are.</p>
  </div>

  <h3>So what is a pipe for?</h3>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Reason</th><th>Evidence</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>The buffer management is not yours</strong></td><td>The stream version contains a resize, two <code>Array.Copy</code> calls and an index shuffle. Every one is a place to be wrong, and the original reader <em>was</em> wrong there. The pipe reader has none of them.</td></tr>
        <tr><td><strong>Back pressure exists</strong></td><td>Measured: 4 KB held against 102 KB grown, same producer and consumer. A <code>Stream</code> cannot express this at all.</td></tr>
        <tr><td><strong>Bounding a message is four lines</strong></td><td><code>buffer.Length</code> without copying: 10,000 bytes rejected against a 256-byte limit.</td></tr>
        <tr><td><strong>Memory is pooled across connections</strong></td><td>One array per connection becomes blocks from a shared pool.</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's original reader dropped records silently for eighteen months' worth of deployments and
    only failed when a partner changed their sender. The record <em>count</em> stayed plausible against
    a feed whose volume varies anyway, so no alert fired — the corruption was found during a quarterly
    reconciliation, weeks after it started.</p>
    <p>At 200,000 records a night across nine partners, the rewrite was not chosen for the 5 ms. It was
    chosen because the framing code moved into the library, the connection now rejects a hostile
    client at 256 bytes instead of growing until the pod dies, and a slow consumer costs 4 KB instead
    of whatever the partner chose to send.</p>
  </div>

  <p><strong>The honest recommendation:</strong> reach for a pipe when you are framing messages off a
  network connection, where correctness under fragmentation and back pressure are the problems. Do not
  rewrite a working file parser as a pipe expecting it to get faster.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Parsing each read independently</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Discards everything after the last delimiter"><code>while ((read = stream.Read(buffer, 0, buffer.Length)) &gt; 0)
{
    ReadOnlySpan&lt;byte&gt; chunk = buffer.AsSpan(0, read);

    while (true)
    {
        int newline = chunk.IndexOf((byte)'\n');
        if (newline &lt; 0)
        {
            break;      // the remainder is silently thrown away
        }

        Process(chunk[..newline]);
        chunk = chunk[(newline + 1)..];
    }
}</code></pre>

  <h3>2. <code>examined</code> set to <code>consumed</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Over a million empty reads in 200 ms"><code>// No complete record found, so nothing was consumed - but we DID look at
// the whole buffer. Claiming otherwise makes ReadAsync return immediately.
reader.AdvanceTo(buffer.Start, buffer.Start);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="examined is where you stopped looking"><code>reader.AdvanceTo(buffer.Start, buffer.End);</code></pre>

  <h3>3. Searching only <code>FirstSpan</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Waits forever for data that has arrived"><code>int newline = buffer.FirstSpan.IndexOf((byte)'\n');</code></pre>

  <h3>4. Forgetting to complete</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="The reader waits for a writer that has gone"><code>await foreach (byte[] chunk in source)
{
    Memory&lt;byte&gt; memory = writer.GetMemory(chunk.Length);
    chunk.CopyTo(memory);
    writer.Advance(chunk.Length);
    await writer.FlushAsync();
}

// Missing: await writer.CompleteAsync();
// The reader's ReadAsync never sees IsCompleted and hangs.</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Complete in a finally, with the exception if there was one"><code>try
{
    await foreach (byte[] chunk in source.WithCancellation(cancellationToken))
    {
        Memory&lt;byte&gt; memory = writer.GetMemory(chunk.Length);
        chunk.CopyTo(memory);
        writer.Advance(chunk.Length);

        FlushResult result = await writer.FlushAsync(cancellationToken);
        if (result.IsCompleted)
        {
            break;      // the reader has gone
        }
    }
}
catch (Exception ex)
{
    // Completing WITH the exception surfaces it on the reader side rather
    // than looking like a clean end of stream.
    await writer.CompleteAsync(ex);
    throw;
}

await writer.CompleteAsync();</code></pre>

  <h3>5. Advancing further than you wrote</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Publishes pooled memory"><code>Memory&lt;byte&gt; memory = writer.GetMemory(1024);
int written = Encoding.UTF8.GetBytes(record, memory.Span);

// WRONG: memory.Length is at least 1024 and usually more. Advancing by it
// publishes whatever the previous tenant of that pooled block left behind.
writer.Advance(memory.Length);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Advance by what you wrote"><code>writer.Advance(written);</code></pre>

  <h3>6. Ignoring the <code>FlushAsync</code> result</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Breaks the pipe rather than skipping back pressure"><code>// Not awaiting does not opt out of back pressure. A second FlushAsync
// while one is pending throws InvalidOperationException.
_ = writer.FlushAsync();</code></pre>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptoms:</strong> corrupt or missing records that only appear under load; one core at
    100% with no throughput; a connection that hangs until it times out; memory growing with connection
    count.</p>
    <p><strong>Tools:</strong> a fragmenting test double first — it turns three of these into a failing
    test — then <code>dotnet-counters</code>, then a dump.</p>
  </div>

  <h3>Step 1: reproduce fragmentation in a test</h3>

  <p>A <code>MemoryStream</code> returns everything in one read, so it cannot reproduce any of these
  bugs. Feed the parser a sequence you fragment deliberately:</p>

  <pre data-lang="csharp" data-net="10" data-title="The test double that finds framing bugs"><code>using System.Buffers;

// Builds a ReadOnlySequence split into blocks of a chosen size, so a parser
// can be tested against the multi-segment case it will meet in production.
public static ReadOnlySequence&lt;byte&gt; Fragment(byte[] bytes, int blockSize)
{
    var first = new Segment(bytes.AsMemory(0, Math.Min(blockSize, bytes.Length)));
    Segment last = first;

    for (int offset = blockSize; offset &lt; bytes.Length; offset += blockSize)
    {
        last = last.Append(bytes.AsMemory(offset, Math.Min(blockSize, bytes.Length - offset)));
    }

    return new ReadOnlySequence&lt;byte&gt;(first, 0, last, last.Memory.Length);
}

public sealed class Segment : ReadOnlySequenceSegment&lt;byte&gt;
{
    public Segment(ReadOnlyMemory&lt;byte&gt; memory) =&gt; Memory = memory;

    public Segment Append(ReadOnlyMemory&lt;byte&gt; memory)
    {
        var next = new Segment(memory) { RunningIndex = RunningIndex + Memory.Length };
        Next = next;
        return next;
    }
}</code></pre>

  <p><strong>Run your parser at block size 1.</strong> If it works with every byte in its own segment,
  it works. That single test would have caught the Ledger incident, the <code>FirstSpan</code> bug and
  the split-delimiter bug.</p>

  <h3>Step 2: match the symptom to the cause</h3>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Symptom</th><th>Almost always</th></tr>
      </thead>
      <tbody>
        <tr><td>100% CPU, no throughput</td><td><code>examined</code> too small — the spin. Over a million reads in 200 ms.</td></tr>
        <tr><td>Connection hangs, no CPU</td><td><code>examined</code> past what arrived, or a missing <code>CompleteAsync</code>.</td></tr>
        <tr><td>Records silently dropped</td><td>Parsing each read independently, or searching <code>FirstSpan</code> only.</td></tr>
        <tr><td>Duplicated records</td><td><code>consumed</code> not advanced past what was processed.</td></tr>
        <tr><td>Memory grows with connections</td><td>No <code>pauseWriterThreshold</code>, or no maximum message size.</td></tr>
        <tr><td>Garbage at the end of a message</td><td><code>Advance</code> called with the buffer length rather than bytes written.</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Step 3: counters</h3>

  <pre data-lang="bash"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime,Microsoft.AspNetCore.Server.Kestrel</code></pre>

  <p>For the spin, CPU Usage high with a flat Allocation Rate is the signature — the loop is doing no
  work, so it allocates nothing while burning a core. That combination distinguishes it from a busy
  server, which allocates as it works.</p>

  <h3>Step 4: a dump, for the hang</h3>

  <pre data-lang="bash"><code>dotnet-dump collect --process-id 4821 --output hang.dmp
dotnet-dump analyze hang.dmp</code></pre>

  <pre data-lang="text" data-title="At the SOS prompt"><code>&gt; dumpasync
&gt; dumpheap -type System.IO.Pipelines.Pipe
&gt; gcroot &lt;pipe address&gt;</code></pre>

  <p><code>dumpasync</code> shows async state machines parked at their await. A stack of them sitting in
  <code>PipeReader.ReadAsync</code> with no data arriving is the <code>examined</code>-too-far hang, and
  the count tells you how many connections are affected.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Pipelines make parsing faster."</strong></p>
    <p>Measured against a correct hand-written stream parser on an in-memory source, the pipe was
    <strong>3x to 10x slower</strong> and allocated the same. It is a correctness and back-pressure
    tool. Over a socket the I/O dominates and the overhead disappears — but that is the overhead
    vanishing, not a speed-up appearing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"One read returns one message."</strong></p>
    <p>TCP delivers bytes. A read can return half a message, one, two and a half, or a single byte.
    Measured, a parser assuming otherwise found the right <em>number</em> of records with every one
    corrupt — which is why it passed its tests.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>AdvanceTo(consumed)</code> is the normal call."</strong></p>
    <p>It sets <code>examined</code> equal to <code>consumed</code>, which is correct only when you
    consumed everything you looked at. When a message is incomplete you consumed nothing and examined
    everything, and getting that backwards produced over a million empty reads in 200 ms.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>buffer.FirstSpan</code> is the buffer."</strong></p>
    <p>It is the first block. A sequence from a pipe is frequently several, and a message that spans
    two arrives as two segments. Measured: a 27-byte record in four blocks has an 8-byte
    <code>FirstSpan</code>, and the delimiter is not in it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I can skip awaiting FlushAsync to avoid blocking the producer."</strong></p>
    <p>Not awaiting does not opt out of back pressure — it breaks the pipe. A second
    <code>FlushAsync</code> while one is pending throws <code>InvalidOperationException</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Pipelines are only for people writing web servers."</strong></p>
    <p>Kestrel uses them, which is where the reputation comes from. They apply to any framing problem:
    a partner feed, a custom TCP protocol, a message broker client, a log shipper. The question is
    whether you are recovering messages from a byte stream, not what layer you work at.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A pipe removes the need to think about buffer sizes."</strong></p>
    <p>It removes the buffer <em>management</em>. You still choose <code>pauseWriterThreshold</code>,
    which decides how much a slow consumer costs you — measured, 4 KB against 102 KB for the same
    load — and you still need a maximum message size, or a client that never sends a delimiter is a
    denial of service.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's feed reader was wrong for eighteen months and nothing detected it. The record count
    stayed plausible, no exception was thrown, and the corruption was found by a quarterly
    reconciliation weeks after a partner changed their sender.</p>
    <p>That is the shape of a framing bug: it does not fail, it produces <em>different data</em>. A
    parser that drops a third of every record still returns records, and every alert you have is
    watching for the absence of records.</p>
    <p>The defence is not a library. It is a test at block size 1 — if the parser is correct with every
    byte in its own segment, it is correct. The library is what makes that test easy to pass.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Use</th></tr>
      </thead>
      <tbody>
        <tr><td>Framing messages off a socket</td><td><code>System.IO.Pipelines</code></td></tr>
        <tr><td>A custom TCP or binary protocol</td><td>Pipe plus <code>SequenceReader</code></td></tr>
        <tr><td>Lines from a file</td><td><code>StreamReader.ReadLine</code>. Clearer and, measured, faster.</td></tr>
        <tr><td>A whole small payload already in memory</td><td><code>ReadOnlySpan</code>, no pipe</td></tr>
        <tr><td>You need a slow consumer to slow the producer</td><td>Pipe, and set the thresholds deliberately</td></tr>
        <tr><td>You need a maximum message size</td><td>Pipe — <code>buffer.Length</code> is free</td></tr>
        <tr><td>Producer/consumer of <em>objects</em>, not bytes</td><td><code>System.Threading.Channels</code></td></tr>
        <tr><td>Rewriting a working parser for speed</td><td>Nothing. Measure first; it will likely be slower.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>A read returns one complete record and part of a second. What should
    <code>AdvanceTo</code> be called with, and what happens for each of the wrong answers?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong><code>AdvanceTo(afterTheNewline, buffer.End)</code></strong> — consumed the complete
        record, examined all of it including the partial second one.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Call</th><th>What happens</th></tr></thead>
            <tbody>
              <tr><td><code>(afterNewline, buffer.End)</code></td><td><strong>Correct.</strong> The pipe keeps the partial record and waits for more data before waking you.</td></tr>
              <tr><td><code>(afterNewline, afterNewline)</code></td><td><strong>Spin.</strong> The pipe believes the partial record is unexamined, so the next <code>ReadAsync</code> returns immediately with the same bytes. Measured at over a million reads in 200 ms.</td></tr>
              <tr><td><code>(buffer.Start, buffer.End)</code></td><td>The complete record is redelivered next read. If you process it again, it is <strong>duplicated</strong> downstream — for a payments feed that means a double credit.</td></tr>
              <tr><td><code>examined</code> past <code>buffer.End</code></td><td><strong>Hang.</strong> The pipe waits for data beyond what has arrived and <code>ReadAsync</code> never completes.</td></tr>
            </tbody>
          </table>
        </div>
        <p>Measured, after the correct call:</p>
        <pre data-lang="console"><code>   buffer holds 41 bytes: one whole record and part of another
   after AdvanceTo(newline, buffer.End), next read = 13 bytes
   which is the partial second record, kept for us.</code></pre>
        <p><strong>The rule to remember:</strong> <code>consumed</code> is what you are finished with;
        <code>examined</code> is where you stopped looking. If you scanned the whole buffer and found
        no delimiter, <code>examined</code> is <code>buffer.End</code>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>Why does this parser find three records, all corrupt, and why do its tests pass?</p>
    <pre data-lang="csharp" data-net="10"><code>while ((read = stream.Read(buffer, 0, buffer.Length)) &gt; 0)
{
    ReadOnlySpan&lt;byte&gt; chunk = buffer.AsSpan(0, read);

    while (true)
    {
        int newline = chunk.IndexOf((byte)'\n');
        if (newline &lt; 0)
        {
            break;
        }

        Process(chunk[..newline]);
        chunk = chunk[(newline + 1)..];
    }
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>When the inner loop runs out of newlines it <code>break</code>s, and whatever is left in
        <code>chunk</code> is <strong>discarded</strong>. The next read starts fresh, so the beginning
        of every record that straddled a boundary is lost.</p>
        <pre data-lang="console"><code>   records sent  : 3
   records found : 3
     "|123450"
     "0002|EUR|998877"
     "042"</code></pre>
        <p><strong>Why the tests pass, in two parts.</strong></p>
        <p>First, the test almost certainly uses a <code>MemoryStream</code>, which returns everything
        in one read. With no boundaries to straddle, the parser is correct.</p>
        <p>Second — and this is the part worth internalising — <strong>the count is right</strong>.
        Three sent, three found. A test asserting on the number of records passes even against a
        fragmenting stream. Only the contents are wrong.</p>
        <p>The fix is to keep the unconsumed remainder across reads, which is either an accumulator you
        manage or a pipe that manages it. And the test that would have caught it is a stream that
        returns one byte per read.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>This pipe reader works in every test and hangs in production once traffic rises. Find the bug.</p>
    <pre data-lang="csharp" data-net="10"><code>while (true)
{
    ReadResult result = await reader.ReadAsync();
    ReadOnlySequence&lt;byte&gt; buffer = result.Buffer;

    int newline = buffer.FirstSpan.IndexOf((byte)'\n');
    if (newline &gt;= 0)
    {
        Process(buffer.Slice(0, newline));
        reader.AdvanceTo(buffer.GetPosition(newline + 1), buffer.End);
        continue;
    }

    reader.AdvanceTo(buffer.Start, buffer.End);

    if (result.IsCompleted)
    {
        break;
    }
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong><code>FirstSpan</code> is the first block, not the whole sequence.</strong></p>
        <pre data-lang="console"><code>   single segment : FirstSpan  28 of  28 bytes, newline at 27
   four segments  : FirstSpan   8 of  28 bytes, newline at -1</code></pre>
        <p>Under light load a message fits in one pooled block, <code>FirstSpan</code> is the whole
        sequence, and the parser is correct. Under load, messages start spanning blocks — the delimiter
        is in the third block, <code>IndexOf</code> returns −1, and the reader concludes the message is
        incomplete.</p>
        <p>It then waits forever for data <em>that has already arrived</em>. The connection hangs with
        no CPU use and no exception.</p>
        <pre data-lang="csharp" data-net="10"><code>while (true)
{
    ReadResult result = await reader.ReadAsync();
    ReadOnlySequence&lt;byte&gt; buffer = result.Buffer;

    while (TryReadRecord(ref buffer, out ReadOnlySequence&lt;byte&gt; record))
    {
        Process(record);
    }

    reader.AdvanceTo(buffer.Start, buffer.End);

    if (result.IsCompleted)
    {
        break;
    }
}

static bool TryReadRecord(ref ReadOnlySequence&lt;byte&gt; buffer, out ReadOnlySequence&lt;byte&gt; record)
{
    // PositionOf walks segments. For a fast path, check IsSingleSegment
    // first and use FirstSpan.IndexOf there - but write THIS first.
    SequencePosition? newline = buffer.PositionOf((byte)'\n');
    if (newline is null)
    {
        record = default;
        return false;
    }

    record = buffer.Slice(0, newline.Value);
    buffer = buffer.Slice(buffer.GetPosition(1, newline.Value));
    return true;
}</code></pre>
        <p><strong>Two other things the original got wrong</strong>, worth spotting: it processes only
        <em>one</em> record per read even when several arrived, and it uses
        <code>buffer.GetPosition(newline + 1)</code> where <code>newline</code> is an index into the
        first span rather than an offset into the sequence — which is a different position as soon as
        there is more than one segment.</p>
        <p><strong>The test that finds it:</strong> feed the parser a sequence fragmented at one byte
        per segment. If it works there, it works.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>A pipe-based ingest service shows one core at 100% and zero records processed. Memory is flat and
    no exceptions are logged. What is it, and how would you confirm it from outside the process?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>An <code>examined</code> position that is too small</strong> — almost certainly
        <code>AdvanceTo(buffer.Start, buffer.Start)</code> or <code>AdvanceTo(consumed)</code> on a path
        where the message was incomplete.</p>
        <p>The pipe believes there is data you have not looked at, so <code>ReadAsync</code> completes
        immediately with the same bytes, forever. Measured:</p>
        <pre data-lang="console"><code>   read 1: 20 bytes, still no newline
   spins in 200 ms : 1,063,104</code></pre>
        <p><strong>Confirming it from outside</strong>, in order of cost:</p>
        <ol>
          <li><strong>CPU high with a flat Allocation Rate.</strong> From
          <code>dotnet-counters monitor --counters System.Runtime</code>. This combination is the
          giveaway — a genuinely busy server allocates as it works, and a spin loop does no work so it
          allocates nothing.</li>
          <li><strong>Thread count normal.</strong> Rules out thread-pool starvation, which produces
          high latency but not a pinned core.</li>
          <li><strong>A dump.</strong> <code>dotnet-dump collect</code>, then <code>clrstack</code> on
          the hot thread shows it inside the read loop rather than inside your parsing.</li>
        </ol>
        <p><strong>Why it scales badly:</strong> one connection stuck mid-message pins one core. A
        handful of clients that paused after sending a partial record can saturate the machine, and
        they look like perfectly normal idle connections from the network side.</p>
        <p><strong>The fix</strong> is one argument:</p>
        <pre data-lang="csharp" data-net="10"><code>// examined is where you STOPPED LOOKING. You scanned the whole buffer.
reader.AdvanceTo(buffer.Start, buffer.End);</code></pre>
        <p>And the sibling bug is worth knowing while you are here: <code>examined</code> set
        <em>past</em> what arrived hangs the connection instead, with no CPU use at all.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Write a pipe reader for a length-prefixed protocol: four bytes of big-endian length, then that
    many bytes of payload. It must reject oversized messages without buffering them, and survive a
    client that sends one byte at a time.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10"><code>using System.Buffers;
using System.Buffers.Binary;
using System.IO.Pipelines;

public sealed class LengthPrefixedReader
{
    private const int HeaderBytes = 4;
    private readonly int _maxPayloadBytes;
    private readonly ILogger&lt;LengthPrefixedReader&gt; _logger;

    public LengthPrefixedReader(int maxPayloadBytes, ILogger&lt;LengthPrefixedReader&gt; logger)
    {
        _maxPayloadBytes = maxPayloadBytes;
        _logger = logger;
    }

    public async Task ReadAllAsync(PipeReader reader,
        Func&lt;ReadOnlySequence&lt;byte&gt;, Task&gt; onMessage,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            ReadResult result = await reader.ReadAsync(cancellationToken).ConfigureAwait(false);
            ReadOnlySequence&lt;byte&gt; buffer = result.Buffer;

            while (TryReadMessage(ref buffer, out ReadOnlySequence&lt;byte&gt; payload, out bool invalid))
            {
                if (invalid)
                {
                    // Consume nothing further; the connection is not recoverable
                    // because we no longer know where the next header starts.
                    reader.AdvanceTo(buffer.Start, buffer.End);
                    await reader.CompleteAsync().ConfigureAwait(false);
                    return;
                }

                await onMessage(payload).ConfigureAwait(false);
            }

            // consumed = past every complete message. examined = End, because
            // the remainder was inspected and is an incomplete message.
            reader.AdvanceTo(buffer.Start, buffer.End);

            if (result.IsCompleted)
            {
                if (buffer.Length &gt; 0)
                {
                    _logger.LogWarning(
                        "Connection ended with {Bytes} bytes of a partial message", buffer.Length);
                }

                break;
            }
        }

        await reader.CompleteAsync().ConfigureAwait(false);
    }

    private bool TryReadMessage(ref ReadOnlySequence&lt;byte&gt; buffer,
        out ReadOnlySequence&lt;byte&gt; payload, out bool invalid)
    {
        payload = default;
        invalid = false;

        // Not even a header yet.
        if (buffer.Length &lt; HeaderBytes)
        {
            return false;
        }

        // The header itself can span segments, so read it through a reader
        // rather than off FirstSpan.
        Span&lt;byte&gt; header = stackalloc byte[HeaderBytes];
        buffer.Slice(0, HeaderBytes).CopyTo(header);
        uint length = BinaryPrimitives.ReadUInt32BigEndian(header);

        // Reject BEFORE waiting for the payload. This is the whole point:
        // a 4 GB length prefix must not cause us to buffer 4 GB.
        if (length &gt; (uint)_maxPayloadBytes)
        {
            _logger.LogWarning(
                "Rejecting message: declared length {Length} exceeds limit {Limit}",
                length, _maxPayloadBytes);

            invalid = true;
            return true;
        }

        // Header is valid but the payload has not all arrived.
        if (buffer.Length &lt; HeaderBytes + length)
        {
            return false;
        }

        payload = buffer.Slice(HeaderBytes, length);
        buffer = buffer.Slice(HeaderBytes + length);
        return true;
    }
}</code></pre>
        <p><strong>The decisions that matter, and why:</strong></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Decision</th><th>Reason</th></tr></thead>
            <tbody>
              <tr><td>Check the length <em>before</em> waiting for the payload</td><td>The entire defence. A client sending a 4 GB length prefix must be rejected on 4 bytes, not after buffering 4 GB.</td></tr>
              <tr><td>Copy the header to the stack</td><td>4 bytes, bounded, and it can span segments — reading it off <code>FirstSpan</code> is the bug from exercise 3.</td></tr>
              <tr><td>Close the connection on an invalid length</td><td>Once a header is nonsense you no longer know where the next one starts. There is nothing to resynchronise to.</td></tr>
              <tr><td>Return <code>true</code> with <code>invalid</code> set</td><td>Keeps "found something" and "it was bad" separate from "need more data", which is the three-way distinction the naive <code>bool</code> loses.</td></tr>
              <tr><td>Warn on a partial message at completion</td><td>A connection that ends mid-message is a client bug or a network problem, and silently ignoring it hides both.</td></tr>
              <tr><td><code>AdvanceTo(buffer.Start, buffer.End)</code></td><td>Consumed every complete message; examined all of the remainder. Anything else spins or hangs.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>Why one byte at a time works:</strong> nothing in <code>TryReadMessage</code>
        assumes how much arrived. With one byte buffered it returns false at the first length check;
        the pipe keeps the byte; the next read has two. The pipe holding the remainder is what makes
        this fall out rather than needing code.</p>
        <p><strong>The test to write:</strong> the same messages at block sizes 1, 3, 7 and 4096. Block
        size 1 exercises every partial-arrival path at once.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>A colleague proposes rewriting the nightly CSV file importer with pipelines, "because Kestrel
    uses them and they are the fast way to parse". You have the measurements. What do you say?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Correct the premise first, with the number.</strong> Against a correct hand-written
        stream parser on an in-memory source:</p>
        <pre data-lang="console"><code>   correct hand-written stream parser :      2 ms
   pipe parser                        :     21 ms
   pipe is 9.8x the time on an in-memory source</code></pre>
        <p>And on the full feed comparison, three to seven times slower at every chunk size, with both
        allocating essentially nothing.</p>
        <p><strong>Be precise about why</strong>, because the number alone invites the wrong
        conclusion. The pipe adds async machinery per read. Over a socket the I/O dominates and that
        overhead disappears into the noise — so this is evidence against pipes as a
        <em>throughput optimisation</em>, not evidence against pipes over a network.</p>
        <p><strong>Then ask what problem the rewrite solves.</strong> For a file importer:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Pipe's benefit</th><th>Does the importer have this problem?</th></tr></thead>
            <tbody>
              <tr><td>Framing under fragmentation</td><td><strong>No.</strong> <code>StreamReader.ReadLine</code> already frames correctly, and a file does not fragment adversarially.</td></tr>
              <tr><td>Back pressure</td><td><strong>No.</strong> The reader sets the pace; there is no independent producer.</td></tr>
              <tr><td>Bounded message size against hostile input</td><td><strong>Maybe</strong>, if partners can send a file with no newlines — but a file length check is simpler.</td></tr>
              <tr><td>Pooled buffers across connections</td><td><strong>No.</strong> There is one importer, not ten thousand connections.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>What I would say:</strong> no to the rewrite, and here is what I would do instead.</p>
        <ol>
          <li><strong>Measure the importer first.</strong> If it is slow, find out whether it is I/O
          bound, allocation bound or CPU bound. A pipe helps with none of those.</li>
          <li><strong>If allocation is the problem</strong>, the win is in the parsing rather than the
          reading — spans instead of <code>Substring</code>, UTF-8 instead of decoding to UTF-16.</li>
          <li><strong>If peak memory is the problem</strong>, the win is streaming instead of
          <code>ReadAllText</code>, which is a much smaller change.</li>
        </ol>
        <p><strong>And where I would agree with them:</strong> the partner <em>feed</em> reader — the
        live TCP one — is a genuine candidate, because it has all four problems in the table. That is
        the same team's code and a much better target.</p>
        <p>"Kestrel uses them" is true and is not a reason. Kestrel frames HTTP off sockets at very high
        connection counts, which is the problem pipelines were designed for.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What is framing, and why can a <code>Stream</code> not do it for you?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Recovering message boundaries from a byte stream that has none. A
        <code>Stream</code> delivers whatever bytes have arrived, so a message can be split across reads
        or several can arrive together — and it has no concept of a message to work with.</p></div>
      </details></li>

    <li><p>Why does a parser that handles each read independently pass its tests?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A <code>MemoryStream</code> returns everything in one read, so
        there are no boundaries to straddle. And even against a fragmenting stream the record
        <em>count</em> is right — measured, 3 sent and 3 found, with all three corrupt.</p></div>
      </details></li>

    <li><p>What do <code>consumed</code> and <code>examined</code> mean?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>consumed</code> is what you are finished with — the pipe may
        discard it. <code>examined</code> is what you have looked at — the pipe will not complete
        another read until there is data past it.</p></div>
      </details></li>

    <li><p>What happens if <code>examined</code> is too small? Too large?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Too small: <code>ReadAsync</code> returns immediately with the same
        data, forever — measured at over a million reads in 200 ms, pinning a core.</p>
        <p>Too large: the pipe waits for data past what has arrived and <code>ReadAsync</code> never
        completes, so the connection hangs.</p></div>
      </details></li>

    <li><p>Why is <code>buffer.FirstSpan.IndexOf(...)</code> not enough?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>FirstSpan</code> is the first block. A pipe hands out pooled
        memory in blocks, so a message spanning two arrives as two segments — measured, an 8-byte
        <code>FirstSpan</code> for a 27-byte record, with the delimiter not in it.</p>
        <p>Use <code>SequenceReader</code> or <code>PositionOf</code>, with
        <code>IsSingleSegment</code> as a fast path.</p></div>
      </details></li>

    <li><p>What is back pressure, and which call provides it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>PipeWriter.FlushAsync</code>. It does not complete while the
        pipe holds more than <code>pauseWriterThreshold</code>, so awaiting it makes the producer run at
        the consumer's rate. Measured: 4 KB held against 102 KB grown, same load.</p>
        <p>Not awaiting it does not skip back pressure — a second <code>FlushAsync</code> while one is
        pending throws.</p></div>
      </details></li>

    <li><p>How do you bound the memory one connection can cost you?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Set <code>pauseWriterThreshold</code>, and check
        <code>buffer.Length</code> against a maximum message size on every read.
        <code>buffer.Length</code> is known without copying, so the check is free — measured, 10,000
        bytes rejected against a 256-byte limit.</p></div>
      </details></li>

    <li><p>Are pipelines faster than a stream parser?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. Measured against a correct hand-written stream parser on an
        in-memory source, the pipe was <strong>3x to 10x slower</strong> and allocated the same.</p>
        <p>They are a correctness and back-pressure tool. Over a socket the I/O dominates and the
        overhead disappears, which is different from a speed-up.</p></div>
      </details></li>

    <li><p>What must you pass to <code>PipeWriter.Advance</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The number of bytes you actually wrote — never
        <code>memory.Length</code>. <code>GetMemory</code> returns at least what you asked for and
        usually more, so advancing by its length publishes whatever the previous tenant of that pooled
        block left behind.</p></div>
      </details></li>

    <li><p>What single test would have caught the Ledger incident?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Running the parser against a stream or sequence fragmented at
        <strong>one byte per segment</strong>. If it is correct there it is correct anywhere, and it
        exercises every partial-arrival path at once.</p>
        <p>That one test also catches the <code>FirstSpan</code> bug and the split-delimiter bug.</p></div>
      </details></li>
  </ol>
</section>
`
});
