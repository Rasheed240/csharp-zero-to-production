CSPREP.module({
  id: "t2-22-streams-and-buffering",
  minutes: 55,
  updated: "2026-09-02",
  summary: "Stream.Read is allowed to return fewer bytes than you asked for, and returns 0 only at the end - a local file usually fills the buffer, which is why the bug reaches production and fails on a socket. Ledger's importer held the whole file: peak memory 11.6 MB, 39.8 MB, 157.2 MB as the file grew, against a flat 1.2 MB streamed. And File.OpenRead gives you a SYNCHRONOUS handle, so 60 concurrent readers took 7x longer at the same peak thread count, because the pool queues rather than grows.",
  terms: ["stream", "short read", "ReadExactly", "ReadAtLeast", "buffer", "BufferedStream",
    "syscall", "flush", "byte-order mark", "seekable", "CanSeek", "useAsync",
    "FileOptions.Asynchronous", "sync-over-async", "peak memory", "live set",
    "stream decorator", "leaveOpen", "CopyTo", "CA2022"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger imports a settlement file from each partner bank every night. The importer ran unchanged
  for two years on files between 20 and 80 megabytes.</p>

  <p>A new partner sent 900 MB. The pod was killed by the kernel before it finished reading. The code
  had no bug in it in the ordinary sense — it worked correctly on every file it had ever seen. It was
  written to hold the whole file:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Correct, and doomed"><code>string text = File.ReadAllText(path);
string[] lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);

foreach (string line in lines)
{
    string[] fields = line.Split(',');
    total += long.Parse(fields[2], CultureInfo.InvariantCulture);
}</code></pre>

  <p>Measured, on files of increasing size:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   file size   strategy         peak managed   allocated       time   records
   ---------   --------         ------------   ---------       ----   -------
        1 MB   ReadAllText           11.6 MB       25 MB       57 ms    50,000
        1 MB   StreamReader           1.2 MB        5 MB       15 ms    50,000

        7 MB   ReadAllText           39.8 MB       99 MB      129 ms   200,000
        7 MB   StreamReader           0.8 MB       20 MB       28 ms   200,000

       29 MB   ReadAllText          157.2 MB      396 MB      482 ms   800,000
       29 MB   StreamReader           2.8 MB       80 MB       89 ms   800,000</code></pre>

  <p><strong>One column grows with the file and one does not.</strong> That is the entire difference,
  and it is the difference between a job that fails at some size nobody has chosen yet and one that
  cannot.</p>

  <p>This module is about the <code>Stream</code> abstraction that makes the second column possible:
  the contract it actually offers — which is weaker than almost everyone assumes — how buffering
  works and what size to make a buffer, and the flag that decides whether your asynchronous file I/O
  is asynchronous at all.</p>
</section>

<section id="plain-language">
  <h2>What a stream is</h2>

  <p class="define"><span class="define__term">Stream</span> An abstraction over a sequence of bytes
  you read or write a piece at a time, without holding all of it. A file, a network socket, an
  in-memory buffer, a compression codec and an encryption layer are all streams, and code written
  against the abstraction works with all of them.</p>

  <p class="define"><span class="define__term">Buffer</span> A block of memory that batches small
  reads or writes into large ones. It trades memory for a reduction in calls to the operating
  system.</p>

  <p class="define"><span class="define__term">Syscall</span> A call from your process into the
  operating system kernel. It costs a transition that is expensive relative to moving bytes, which is
  why the <em>number</em> of calls matters more than the number of bytes.</p>

  <p class="define"><span class="define__term">Peak memory</span> The most memory live at any one
  instant during an operation. Distinct from total allocation, which counts everything ever created
  including what was immediately thrown away.</p>

  <p class="define"><span class="define__term">Short read</span> A read that returns fewer bytes
  than you asked for without having reached the end. Legal, common on anything but a local file, and
  the cause of the single most frequent stream bug.</p>

  <p class="define"><span class="define__term">Flush</span> Pushing whatever is in a buffer to the
  layer beneath. Until it happens the data exists only in your process, so a crash loses it.</p>

  <p class="define"><span class="define__term">Seekable</span> Able to move to an arbitrary position
  and read again. Files are; sockets, pipes and compression streams are not, and asking them for a
  <code>Length</code> throws.</p>

  <p class="define"><span class="define__term">Byte-order mark</span> Three bytes some encoders write
  at the start of a UTF-8 file to announce the encoding. Harmless to a human, and enough to break a
  CSV header match or a strict JSON parser.</p>

  <p class="define"><span class="define__term">Overlapped I/O</span> Asking the operating system to
  perform a read and notify you when it finishes, rather than blocking a thread until it does. This is
  what <code>FileOptions.Asynchronous</code> switches on, and it is off by default.</p>

  <p class="define"><span class="define__term">Stream decorator</span> A stream that wraps another
  and adds behaviour - buffering, counting, compression, encryption. Getting one right means overriding
  the span and async paths as well as the array one.</p>

  <p><strong>An analogy, and its limits.</strong> A stream is a conveyor belt rather than a warehouse.
  You take items off as they arrive and deal with them; you never need floor space for the whole
  delivery. A buffer is a small trolley at the end of the belt, so you walk to the shelf once with
  twenty items rather than twenty times with one.</p>

  <p><strong>Where the analogy breaks:</strong> a conveyor belt delivers what you asked for. A stream
  read hands you <em>whatever it has right now</em>, which may be less, and the single most common
  stream bug is code that assumes otherwise. That is section three.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's importer peaked at 157 MB for a 29 MB file — about 5.4x the file size, because three
    copies exist at once: the bytes read from disk, the UTF-16 string they decode to at two bytes per
    character, and the array of substrings <code>Split</code> produces.</p>
    <p>Extrapolate that to the 900 MB file the partner sent and the peak is several gigabytes, in a
    pod with a 1 GB limit. The streamed version's peak was 2.8 MB at 29 MB of input and would have
    been 2.8 MB at 900 MB, because it holds one buffer and one line.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — Read may return fewer bytes than you asked for, and
// peak memory should not depend on the input size.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

using System.Text;

byte[] payload = Encoding.UTF8.GetBytes("INV-2026-0004821|GBP|123450|SETTLED");

Console.WriteLine("Reading 35 bytes from a stream that serves 8 at a time:");
Console.WriteLine();

using (var stream = new ChunkedStream(payload, maxPerRead: 8))
{
    var buffer = new byte[payload.Length];
    int read = stream.Read(buffer, 0, buffer.Length);

    Console.WriteLine($"  Read(...)     returned {read} bytes");
    Console.WriteLine($"                \"{Encoding.UTF8.GetString(buffer).TrimEnd('\0')}\"");
}

using (var stream = new ChunkedStream(payload, maxPerRead: 8))
{
    var buffer = new byte[payload.Length];
    stream.ReadExactly(buffer);

    Console.WriteLine($"  ReadExactly   filled the buffer");
    Console.WriteLine($"                \"{Encoding.UTF8.GetString(buffer)}\"");
}

Console.WriteLine();
Console.WriteLine("Read returns between 0 and count bytes, and 0 only at the end of the");
Console.WriteLine("stream. Nothing promises it fills the buffer. A local file usually does,");
Console.WriteLine("which is why this bug reaches production and fails on a socket.");
Console.WriteLine();
Console.WriteLine("ReadExactly throws EndOfStreamException on a short stream, so the");
Console.WriteLine("failure is loud instead of being a half-filled buffer.");

// A stream that serves at most maxPerRead bytes per call - which is exactly
// how a socket behaves when data arrives in packets.
sealed class ChunkedStream : Stream
{
    private readonly byte[] _data;
    private readonly int _maxPerRead;
    private int _position;

    public ChunkedStream(byte[] data, int maxPerRead)
    {
        _data = data;
        _maxPerRead = maxPerRead;
    }

    public override bool CanRead =&gt; true;

    public override bool CanSeek =&gt; false;

    public override bool CanWrite =&gt; false;

    public override long Length =&gt; throw new NotSupportedException();

    public override long Position
    {
        get =&gt; throw new NotSupportedException();
        set =&gt; throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        int available = _data.Length - _position;
        if (available == 0)
        {
            return 0;
        }

        int toCopy = Math.Min(Math.Min(count, _maxPerRead), available);
        Array.Copy(_data, _position, buffer, offset, toCopy);
        _position += toCopy;
        return toCopy;
    }

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) =&gt; throw new NotSupportedException();

    public override void SetLength(long value) =&gt; throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) =&gt; throw new NotSupportedException();
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>Reading 35 bytes from a stream that serves 8 at a time:

  Read(...)     returned 8 bytes
                "INV-2026"
  ReadExactly   filled the buffer
                "INV-2026-0004821|GBP|123450|SETTLED"</code></pre>

  <p>The first call asked for 35 bytes and got 8. It did not fail, throw, or signal anything — it
  returned 8, and code that ignores the return value now has a record that is a quarter present and
  three quarters zeros.</p>
</section>

<section id="the-contract">
  <h2>The contract, which is weaker than you think</h2>

  <p><code>Stream.Read(buffer, offset, count)</code> promises exactly two things:</p>

  <ul>
    <li>It returns between 0 and <code>count</code> bytes.</li>
    <li>It returns <strong>0 only at the end of the stream.</strong></li>
  </ul>

  <p>It does <em>not</em> promise to fill the buffer. A <code>FileStream</code> on a local disk
  normally does, which is exactly why this bug survives testing and fails in production — a network
  stream, a compression stream, a pipe and a file on a remote volume all return short reads
  routinely.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Works on a file, fails on a socket"><code>var buffer = new byte[length];
stream.Read(buffer, 0, length);
return Encoding.UTF8.GetString(buffer);</code></pre>

  <p>Two bugs in three lines: the return value is discarded, and even if it were not,
  <code>GetString</code> is decoding the whole buffer rather than the part that was filled.</p>

  <h3>Four correct APIs, in the order to reach for them</h3>

  <pre data-lang="csharp" data-net="10" data-title="01-stream-contract.cs"><code>static void TheFixes()
{
    Console.WriteLine("3. RIGHT - four APIs, in order of preference");
    Console.WriteLine();

    byte[] payload = Encoding.UTF8.GetBytes("INV-2026-0004821|GBP|123450|SETTLED");

    // (a) ReadExactly: .NET 7+. Throws EndOfStreamException if the stream ends
    //     early, which is what you want when the length is known.
    using (var source = new ChunkedStream(payload, maxPerRead: 8))
    {
        var buffer = new byte[payload.Length];
        source.ReadExactly(buffer);
        Console.WriteLine($"   ReadExactly    : \"{Encoding.UTF8.GetString(buffer)}\"");
        Console.WriteLine($"     reads issued : {source.ReadCount}");
    }

    // (b) ReadAtLeast: when you need a minimum but can use more.
    using (var source = new ChunkedStream(payload, maxPerRead: 8))
    {
        var buffer = new byte[payload.Length];
        int got = source.ReadAtLeast(buffer, minimumBytes: 16);
        Console.WriteLine($"   ReadAtLeast(16): got {got} bytes in {source.ReadCount} reads");
    }

    // (c) The hand-written loop, which is what ReadExactly does. Worth being
    //     able to write, because you will meet it in older code.
    using (var source = new ChunkedStream(payload, maxPerRead: 8))
    {
        var buffer = new byte[payload.Length];
        int total = 0;
        while (total &lt; buffer.Length)
        {
            int n = source.Read(buffer, total, buffer.Length - total);
            if (n == 0)
            {
                break;      // genuine end of stream
            }

            total += n;
        }

        Console.WriteLine($"   manual loop    : \"{Encoding.UTF8.GetString(buffer, 0, total)}\"");
    }

    // (d) CopyTo, when you want all of it and do not need it in one buffer.
    using (var source = new ChunkedStream(payload, maxPerRead: 8))
    using (var destination = new MemoryStream())
    {
        source.CopyTo(destination);
        Console.WriteLine($"   CopyTo         : \"{Encoding.UTF8.GetString(destination.ToArray())}\"");</code></pre>

  <pre data-lang="console" data-title="01-stream-contract.cs"><code>   ReadExactly    : "INV-2026-0004821|GBP|123450|SETTLED"
     reads issued : 5
   ReadAtLeast(16): got 16 bytes in 2 reads
   manual loop    : "INV-2026-0004821|GBP|123450|SETTLED"
   CopyTo         : "INV-2026-0004821|GBP|123450|SETTLED"

   truncated source + ReadExactly -&gt; EndOfStreamException</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>API</th><th>Use when</th><th>On a short stream</th></tr>
      </thead>
      <tbody>
        <tr><td><code>ReadExactly</code></td><td>You know the length and need all of it</td><td>Throws <code>EndOfStreamException</code></td></tr>
        <tr><td><code>ReadAtLeast</code></td><td>You need a minimum but can use more</td><td>Throws, unless <code>throwOnEndOfStream: false</code></td></tr>
        <tr><td>A manual loop</td><td>You must handle partial data yourself</td><td>Whatever you write</td></tr>
        <tr><td><code>CopyTo</code></td><td>You want all of it and not in one buffer</td><td>Copies what exists</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong><code>ReadExactly</code> is the default answer when the length is known.</strong> It was
  added in .NET 7 precisely because the manual loop was written wrongly so often, and it throws rather
  than returning a half-filled buffer — so the failure is loud instead of becoming a corrupt record.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Analyser rule <strong>CA2022</strong> flags a discarded <code>Read</code> return value. It is
    not on by default.</p>
    <p>It caught a discarded result in this module's own verification code, in the file whose subject
    is that discarding it is a bug. Turn it on.</p>
  </div>

  <h3>Not every stream can seek</h3>

  <pre data-lang="console" data-title="01-stream-contract.cs"><code>   stream            CanRead  CanWrite  CanSeek  Length
   MemoryStream      True     True      True     10
   ChunkedStream     True     False     False    (throws)

   forwardOnly.Length -&gt; NotSupportedException</code></pre>

  <p>A network stream, a compression stream and a pipe cannot seek and have no length. Code that reads
  <code>Length</code> to size a buffer works perfectly on a file and throws the first time somebody
  points it at a socket.</p>

  <p><strong>Check <code>CanSeek</code> before seeking, and never require <code>Length</code>.</strong>
  If you need the size, be told it out of band — a <code>Content-Length</code> header — or stream
  without needing it.</p>
</section>

<section id="buffering">
  <h2>Buffering, and what size to make it</h2>

  <pre data-lang="console" data-title="02-buffering.cs"><code>   65,536 single-byte writes
     straight to the stream :  65,536 calls to the underlying stream
     through a 4 KB buffer  :      16 calls
     reduction              :   4,096x</code></pre>

  <p>That is the whole model. <strong>A buffer trades memory for call count</strong>, and it helps
  exactly when your reads or writes are smaller than the buffer.</p>

  <h3>The size sweep</h3>

  <pre data-lang="console" data-title="02-buffering.cs"><code>   buffer      reads   allocated       time    vs 4 KB
   ------      -----   ---------       ----    -------
     4,096      4,096       5,392 B      91 ms     1.00x
    16,384      1,024      17,488 B      25 ms     3.64x
    65,536        256      66,640 B      18 ms     5.15x
    81,920        205      83,024 B      14 ms     6.37x
   262,144         64     263,248 B      12 ms     7.47x
 1,048,576         16   1,049,680 B      14 ms     6.53x</code></pre>

  <p>The read count is exact and halves as the buffer doubles. The time flattens out well before the
  buffer stops growing — past roughly 64 KB you are paying memory for a syscall count that has already
  stopped being the cost, and at a megabyte it is slower than at 256 KB.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><code>Stream.CopyTo</code>'s default buffer is <strong>81,920 bytes</strong>, and that number is
    not arbitrary. It sits immediately below the 85,000-byte large object heap threshold, so the buffer is
    collected cheaply in generation 0.</p>
    <p>Hand-rolling a copy loop to "tune the buffer" usually reproduces this badly, and picking a
    rounder 128 KB puts every buffer on the LOH.</p>
  </div>

  <pre data-lang="console" data-title="02-buffering.cs"><code>   buffer size   total object size   generation
   -----------   -----------------   ----------
        65,536              65,560   gen 0
        81,920              81,944   gen 0
        84,975              84,999   gen 0
        84,976              85,000   gen 2
       131,072             131,096   gen 2</code></pre>

  <h3>When a second buffer buys nothing</h3>

  <pre data-lang="console" data-title="02-buffering.cs"><code>   read size   FileStream   + BufferedStream   effect
   ---------   ----------   ---------------   ------
       512 B        34 ms              24 ms    1.43x
    65,536 B         5 ms               5 ms    1.03x</code></pre>

  <p>The second row is an honest negative worth recording. The expectation writing this was that
  wrapping an already-buffered <code>FileStream</code> would show a measurable penalty from the extra
  copy. <strong>It does not — about 1.0x.</strong> <code>FileStream</code> detects that the read is at
  least as large as its own buffer and bypasses it.</p>

  <p>So the argument against the wrap is not performance. It is that it is a layer doing nothing, and
  a reader has to work out why it is there.</p>

  <p><code>BufferedStream</code> is for a stream accessed in pieces <em>smaller</em> than the buffer —
  a <code>NetworkStream</code> read a few bytes at a time, or a <code>DeflateStream</code>. The first
  row is where it earns its place.</p>

  <h3>Buffered is not written</h3>

  <pre data-lang="console" data-title="01-stream-contract.cs"><code>   after Write, bytes in the stream : 0
   after Flush, bytes in the stream : 30
   after Dispose                    : 30</code></pre>

  <p>Zero bytes existed until the flush. A process that writes and then exits without disposing loses
  everything still in the buffer — and a crash, a <code>SIGKILL</code>, or a container eviction all
  look exactly like that.</p>

  <p><strong>The <code>using</code> on a writer is not a tidiness convention. It is the line that makes
  the data exist.</strong> Where a write must survive a crash, flush explicitly at the point it becomes
  durable and accept the syscall cost.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>27 characters produced <strong>30 bytes</strong> above. <code>Encoding.UTF8</code> writes a
    three-byte byte-order mark first.</p>
    <p>That BOM is a real interoperability bug: a CSV starting with it gives the first column a name
    no parser matches, and a JSON body starting with it is rejected by strict parsers. Use
    <code>new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)</code> when writing for a
    machine.</p>
  </div>
</section>

<section id="async-io">
  <h2>Asynchronous I/O, and the flag nobody sets</h2>

  <p class="define"><span class="define__term">useAsync</span> A <code>FileStream</code> constructor
  flag — also <code>FileOptions.Asynchronous</code> — that opens the file handle in overlapped mode so
  reads and writes can complete without occupying a thread. <strong>It defaults to false.</strong></p>

  <pre data-lang="console" data-title="03-async-io.cs"><code>   new FileStream(path, ...)                  IsAsync = False
   ... with useAsync: true                    IsAsync = True
   ... via FileOptions.Asynchronous           IsAsync = True</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>A <code>FileStream</code> opened the usual way still has <code>ReadAsync</code>, it still
    returns a <code>Task</code>, and it still yields at the <code>await</code>. But the I/O underneath
    is <strong>synchronous, performed on a thread-pool thread</strong>.</p>
    <p>So the await gives one thread back and immediately borrows another to block. Under load that is
    the same starvation <code>await</code> exists to prevent, moved one layer down where it is harder
    to see.</p>
    <p><code>File.OpenRead</code>, <code>File.ReadAllTextAsync</code> and <code>StreamReader</code> all
    default to the synchronous handle.</p>
  </div>

  <h3>What that costs under concurrency</h3>

  <pre data-lang="console" data-title="03-async-io.cs"><code>   60 concurrent readers

   strategy                          time     peak pool threads
   --------                          ----     -----------------
   Read() on a pool thread          1106 ms                   9
   ReadAsync on an async handle      156 ms                   9</code></pre>

  <p><strong>Read the thread column first, because it is the surprising part.</strong> The pool did not
  grow to absorb the blocking. Both runs peaked at the same number of threads, and the blocking version
  took seven times longer.</p>

  <p>That is precisely why blocking I/O is damaging. The thread pool injects new threads slowly past
  its minimum — on the order of one or two a second — so within any burst you do not get more threads.
  <strong>You get a queue.</strong></p>

  <p>Each of the 60 readers needed 5 reads at 20 ms. Asynchronously they overlap and the whole set
  finishes in about the time of one reader. Blocking, they are serialised across the handful of
  threads that exist.</p>

  <p>In a web service the queued items are requests, and the symptom is <strong>p99 latency climbing
  while CPU sits near idle</strong> — which looks nothing like an I/O problem and sends people to
  profile the wrong thing.</p>

  <h3>Use the <code>Memory</code> overloads</h3>

  <pre data-lang="console" data-title="03-async-io.cs"><code>   20,000 reads of 4,096 bytes
     ReadAsync(byte[], int, int)  :  2,239,368 B   (  112 B per read)
     ReadAsync(Memory&lt;byte&gt;)      :      1,632 B   (    0 B per read)</code></pre>

  <p>The <code>Memory</code> overload returns <code>ValueTask&lt;int&gt;</code>, which does not
  allocate when the read completes synchronously — and a read served from the file system cache
  usually does. There is no case where the array overload is better.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>A <code>CancellationToken</code> on a stream read bounds how long you <em>wait for the
    result</em>, not how long the operation runs. On most platforms a read that has reached the
    operating system cannot be interrupted, so the token is only observed between reads.</p>
    <p>A 30-second read of a stalled network drive will not be cancelled by a 5-second timeout — the
    thread and the handle stay busy. Where it matters, put the timeout on the resource: a socket
    timeout, an <code>HttpClient</code> timeout.</p>
  </div>
</section>

<section id="production">
  <h2>The Ledger importer</h2>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Peak memory scales with the file"><code>static (long Total, int Count) ImportBuffered(string path)
{
    string text = File.ReadAllText(path);
    string[] lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);

    long total = 0;
    int count = 0;

    foreach (string line in lines)
    {
        string[] fields = line.Split(',');
        if (fields.Length &lt; 3)
        {
            continue;
        }

        total += long.Parse(fields[2], CultureInfo.InvariantCulture);
        count++;
    }

    return (total, count);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Peak memory is one buffer and one line"><code>static (long Total, int Count) ImportStreamed(string path)
{
    using var file = new FileStream(path, FileMode.Open, FileAccess.Read,
        FileShare.Read, bufferSize: 64 * 1024);
    using var reader = new StreamReader(file, Encoding.UTF8, detectEncodingFromByteOrderMarks: false,
        bufferSize: 64 * 1024);

    long total = 0;
    int count = 0;

    string? line;
    while ((line = reader.ReadLine()) is not null)
    {
        ReadOnlySpan&lt;char&gt; span = line;

        // Walk to the third comma-separated field without allocating.
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

        ReadOnlySpan&lt;char&gt; amountField = rest[(second + 1)..];
        int third = amountField.IndexOf(',');
        if (third &gt;= 0)
        {
            amountField = amountField[..third];
        }

        if (long.TryParse(amountField, CultureInfo.InvariantCulture, out long amount))
        {
            total += amount;
            count++;
        }
    }

    return (total, count);
}</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>File</th><th><code>ReadAllText</code> peak</th><th>Streamed peak</th><th>Ratio</th></tr>
      </thead>
      <tbody>
        <tr><td>1 MB</td><td>11.6 MB</td><td>1.2 MB</td><td>9.7x</td></tr>
        <tr><td>7 MB</td><td>39.8 MB</td><td>0.8 MB</td><td>50x</td></tr>
        <tr><td>29 MB</td><td>157.2 MB</td><td>2.8 MB</td><td>56x</td></tr>
      </tbody>
    </table>
  </div>

  <p>The streamed version was also <strong>5.4x faster</strong> at 29 MB, which is a side effect rather
  than the goal — it does less work because it never builds 800,000 substrings.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The buffered importer was always going to fail at <em>some</em> file size, and the only question
    was which partner sent it first. Two years of 20–80 MB files was not evidence that it worked; it
    was evidence that nobody had sent a big one.</p>
    <p>The streamed version cannot fail on a bigger file, because its memory does not depend on the
    size. That property — not the 5.4x — is what closed the incident.</p>
  </div>

  <p>Note that the <em>allocated</em> column tells a different story from <em>peak</em>. The streamed
  version still allocates a string per line from <code>ReadLine</code>. Those die in generation 0 and
  never accumulate, so they cost collection time rather than memory.</p>

  <p><strong>That distinction — allocation rate against live set — is what decides whether a service
  degrades or falls over.</strong> The buffered version had a live-set problem, which kills a process.
  The streamed version has an allocation-rate problem, which shows up as pause time.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Assuming <code>Read</code> filled the buffer</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Truncates on any short read"><code>var buffer = new byte[header.ContentLength];
stream.Read(buffer, 0, buffer.Length);
return JsonSerializer.Deserialize&lt;Payment&gt;(buffer);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Loud on a short stream"><code>var buffer = new byte[header.ContentLength];
stream.ReadExactly(buffer);
return JsonSerializer.Deserialize&lt;Payment&gt;(buffer);</code></pre>

  <h3>2. Sizing a buffer from <code>Length</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Throws on a socket, and unbounded on a file"><code>// Two problems. NotSupportedException on any non-seekable stream, and
// on a seekable one it allocates the whole file - which is the incident
// this module opened with.
var buffer = new byte[stream.Length];
stream.ReadExactly(buffer);</code></pre>

  <h3>3. Reading a whole file to process it line by line</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Peak scales with the input"><code>foreach (string line in File.ReadAllLines(path))
{
    Process(line);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Peak is one line"><code>// ReadLines is lazy - it returns an IEnumerable that reads as you
// enumerate. One character of difference from ReadAllLines, and the
// memory profile is completely different.
foreach (string line in File.ReadLines(path))
{
    Process(line);
}</code></pre>

  <h3>4. Async that is not async</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Blocks a pool thread per read"><code>using var stream = File.OpenRead(path);
await stream.ReadAsync(buffer);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="An overlapped handle"><code>await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
    FileShare.Read, bufferSize: 64 * 1024, FileOptions.Asynchronous);

int read = await stream.ReadAsync(buffer, cancellationToken);</code></pre>

  <h3>5. A decorator that counts what it asked for</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   BrokenCountingStream  : bytes counted 95, actual 35
   CountingDecorator     : bytes counted 35, actual 35</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Over-reports on every short read"><code>public override int Read(byte[] buffer, int offset, int count)
{
    BytesRead += count;                      // asked for, not received
    return _inner.Read(buffer, offset, count);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Count what came back, and override the span path"><code>public override int Read(byte[] buffer, int offset, int count) =&gt;
    Read(buffer.AsSpan(offset, count));

public override int Read(Span&lt;byte&gt; buffer)
{
    int read = _inner.Read(buffer);
    BytesRead += read;
    return read;
}

public override async ValueTask&lt;int&gt; ReadAsync(Memory&lt;byte&gt; buffer,
    CancellationToken cancellationToken = default)
{
    int read = await _inner.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
    BytesRead += read;
    return read;
}</code></pre>

  <p>Overriding only the <code>byte[]</code> method means async and span callers bypass the decorator
  entirely through the base class implementations — so a metric silently under-counts instead of
  over-counting, which is worse because it looks plausible.</p>

  <h3>6. Writing a byte-order mark into machine-read output</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Three invisible bytes at the front"><code>using var writer = new StreamWriter(path, false, Encoding.UTF8);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="No preamble"><code>using var writer = new StreamWriter(path, false, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));</code></pre>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptoms:</strong> a job that OOMs on a large input; truncated or corrupt records that
    only appear over a network; p99 latency climbing while CPU is idle; a file that is empty after the
    process exited.</p>
    <p><strong>Tools:</strong> peak memory sampling first (it is fifteen lines and needs no profiler),
    then <code>dotnet-counters</code>, then the analysers.</p>
  </div>

  <h3>Step 1: does peak memory scale with the input?</h3>

  <p>This is the whole diagnostic for the OOM case, and it is the question a memory profiler answers
  slowly and a loop answers immediately:</p>

  <pre data-lang="csharp" data-net="10" data-title="Sample the live heap while the work runs"><code>static long MeasurePeak(Action body)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long baseline = GC.GetTotalMemory(true);
    long peak = baseline;

    using var stop = new CancellationTokenSource();
    var sampler = new Thread(() =&gt;
    {
        while (!stop.IsCancellationRequested)
        {
            long now = GC.GetTotalMemory(false);
            if (now &gt; peak)
            {
                peak = now;
            }

            Thread.Sleep(1);
        }
    })
    {
        IsBackground = true
    };

    sampler.Start();
    body();
    stop.Cancel();
    sampler.Join();

    return peak - baseline;
}</code></pre>

  <p><strong>Run it at two input sizes.</strong> If the peak roughly doubles when the input doubles,
  you are holding the input, and no amount of tuning will fix it — the shape of the code has to
  change.</p>

  <h3>Step 2: is the async actually async?</h3>

  <pre data-lang="csharp" data-net="10" data-title="One line, and it settles the argument"><code>_logger.LogInformation("stream isAsync={IsAsync}", stream is FileStream fs &amp;&amp; fs.IsAsync);</code></pre>

  <p>For the pool-starvation symptom, watch these while load is applied:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Counter</th><th>What it tells you</th></tr>
      </thead>
      <tbody>
        <tr><td>ThreadPool Thread Count</td><td>Climbing slowly under load is the injection rate — the queue is growing.</td></tr>
        <tr><td>ThreadPool Queue Length</td><td>Sustained above zero with idle CPU means work is waiting for threads, not for the CPU.</td></tr>
        <tr><td>% Time in GC</td><td>Rules out the other cause of the same symptom.</td></tr>
        <tr><td>CPU Usage</td><td>Idle CPU with climbing latency is the signature of blocking I/O.</td></tr>
      </tbody>
    </table>
  </div>

  <pre data-lang="bash"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime</code></pre>

  <h3>Step 3: catch the truncation in a test</h3>

  <p>A local file will not reproduce a short read. Write a stream that guarantees one:</p>

  <pre data-lang="csharp" data-net="10" data-title="A test double worth keeping"><code>// Serves at most maxPerRead bytes per call, which is what a socket does
// when data arrives in packets. Any parser that passes its tests against
// a MemoryStream and fails against this has the short-read bug.
public sealed class ChunkedStream : Stream
{
    private readonly byte[] _data;
    private readonly int _maxPerRead;
    private int _position;

    public ChunkedStream(byte[] data, int maxPerRead)
    {
        _data = data;
        _maxPerRead = maxPerRead;
    }

    public override bool CanRead =&gt; true;

    public override bool CanSeek =&gt; false;

    public override bool CanWrite =&gt; false;

    public override long Length =&gt; throw new NotSupportedException();

    public override long Position
    {
        get =&gt; throw new NotSupportedException();
        set =&gt; throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        int available = _data.Length - _position;
        if (available == 0)
        {
            return 0;
        }

        int toCopy = Math.Min(Math.Min(count, _maxPerRead), available);
        Array.Copy(_data, _position, buffer, offset, toCopy);
        _position += toCopy;
        return toCopy;
    }

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) =&gt; throw new NotSupportedException();

    public override void SetLength(long value) =&gt; throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) =&gt; throw new NotSupportedException();
}</code></pre>

  <h3>Step 4: the analysers</h3>

  <pre data-lang="xml" data-title="Directory.Build.props"><code>&lt;PropertyGroup&gt;
  &lt;AnalysisMode&gt;Recommended&lt;/AnalysisMode&gt;

  &lt;!-- CA2022: an inexact Read whose return value is ignored.
       CA1835: prefer the Memory overloads of ReadAsync/WriteAsync.
       CA2007: a missing ConfigureAwait in library code. --&gt;
  &lt;WarningsAsErrors&gt;$(WarningsAsErrors);CA2022;CA1835&lt;/WarningsAsErrors&gt;
&lt;/PropertyGroup&gt;</code></pre>

  <p><strong>CA2022 is the one that matters here</strong>, and it is off by default.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Read fills the buffer unless the stream has ended."</strong></p>
    <p>It returns between 0 and <code>count</code> bytes and returns 0 only at the end. Measured, a
    request for 35 bytes returned 8 from a stream serving packets. A local file usually does fill the
    buffer, which is why the bug passes testing and fails on a socket.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A bigger buffer is faster."</strong></p>
    <p>Up to a point. Measured on a 16 MB copy, 4 KB to 64 KB was a 5.15x improvement; 64 KB to 1 MB
    was <em>slower</em> than 256 KB. Past roughly 64 KB the syscall count has stopped being the cost,
    and above 85,000 bytes every buffer is born on the large object heap.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Wrapping a FileStream in a BufferedStream makes it faster."</strong></p>
    <p>Measured at 1.03x for 64 KB reads — neither a win nor a measurable loss, because
    <code>FileStream</code> bypasses its own buffer for reads that large. It is a layer doing nothing.
    <code>BufferedStream</code> is for streams accessed in pieces smaller than the buffer.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"ReadAsync on a FileStream is asynchronous."</strong></p>
    <p>Only if the handle was opened with <code>useAsync: true</code> or
    <code>FileOptions.Asynchronous</code>, and the default is <strong>false</strong>.
    <code>File.OpenRead</code> gives you a synchronous handle, so the read runs synchronously on a
    thread-pool thread while the await pretends otherwise.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Blocking I/O is fine because the thread pool will add threads."</strong></p>
    <p>It adds them at roughly one or two a second past the minimum. Measured, 60 concurrent blocking
    readers took 7x longer than the async equivalent <em>at the same peak thread count</em> — the pool
    did not grow, it queued.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Passing a CancellationToken bounds how long the read takes."</strong></p>
    <p>It bounds how long you wait to observe the result. A read that has reached the operating system
    generally cannot be interrupted, so the thread and the handle stay occupied. Put the timeout on the
    resource as well.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The data is written once Write returns."</strong></p>
    <p>Measured: zero bytes reached the stream until <code>Flush</code>. Everything up to the buffer
    size is held in memory, and a process that is killed never runs <code>Dispose</code>.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Two failures in this module have the same root and completely different symptoms.</p>
    <p><strong>Holding the input</strong> gives a peak that scales: 157 MB for a 29 MB file, and
    several gigabytes for the 900 MB one that killed the pod. This kills a process outright, and it
    fails at a size determined by whoever sends you data rather than by anything you control.</p>
    <p><strong>Blocking I/O</strong> gives a queue: 60 readers took 7x longer at the same thread
    count. This does not kill anything. It degrades p99 while CPU sits idle, which is the harder of
    the two to diagnose because every graph looks healthy.</p>
    <p>The shared root is treating a stream as if it were an array you happen to reach through a
    method call.</p>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Do this</th></tr>
      </thead>
      <tbody>
        <tr><td>You know how many bytes you need</td><td><code>ReadExactly</code></td></tr>
        <tr><td>You need a minimum, can use more</td><td><code>ReadAtLeast</code></td></tr>
        <tr><td>Copying one stream to another</td><td><code>CopyTo</code> / <code>CopyToAsync</code>, default buffer</td></tr>
        <tr><td>Processing a file line by line</td><td><code>File.ReadLines</code>, never <code>ReadAllLines</code></td></tr>
        <tr><td>Choosing a buffer size</td><td>64 KB, or 81,920. Never above 85,000 per operation.</td></tr>
        <tr><td>Opening a file for async work</td><td><code>FileOptions.Asynchronous</code>, explicitly</td></tr>
        <tr><td>Calling <code>ReadAsync</code></td><td>The <code>Memory&lt;byte&gt;</code> overload</td></tr>
        <tr><td>Writing output a machine will parse</td><td><code>new UTF8Encoding(false)</code></td></tr>
        <tr><td>A write that must survive a crash</td><td>Flush explicitly at the durability point</td></tr>
        <tr><td>Wrapping a stream</td><td>Override the span and async paths too, and decide about <code>leaveOpen</code></td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>What is wrong with this method, and why does it pass its tests?</p>
    <pre data-lang="csharp" data-net="10"><code>public string ReadHeader(Stream stream, int length)
{
    var buffer = new byte[length];
    stream.Read(buffer, 0, length);
    return Encoding.UTF8.GetString(buffer);
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The return value of <code>Read</code> is discarded.</strong> It may return fewer
        bytes than <code>length</code>, and the rest of the buffer stays zeros:</p>
        <pre data-lang="console"><code>   discarding the return value : "INV-2026" (read 8)
   ReadExactly                 : "INV-2026-0004821|GBP|123450"</code></pre>
        <p><strong>Why the tests pass:</strong> they almost certainly use a
        <code>MemoryStream</code> or a local file, and both fill the buffer in one call. A socket, a
        <code>DeflateStream</code> or a file on a network volume does not.</p>
        <pre data-lang="csharp" data-net="10"><code>public string ReadHeader(Stream stream, int length)
{
    var buffer = new byte[length];
    stream.ReadExactly(buffer);
    return Encoding.UTF8.GetString(buffer);
}</code></pre>
        <p>There is a second bug even after fixing the first: <code>GetString(buffer)</code> decodes
        the whole array. If you use <code>ReadAtLeast</code> or a manual loop rather than
        <code>ReadExactly</code>, you must decode only <code>buffer.AsSpan(0, read)</code>.</p>
        <p>To catch this in a test, read through a stream that guarantees short reads — the
        <code>ChunkedStream</code> in the debugging section is fifty lines and turns this from a
        production incident into a red test.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>A service writes an audit line per payment and the file is empty after the pod restarts. The
    code is below and it has no exception in the logs. Why?</p>
    <pre data-lang="csharp" data-net="10"><code>private readonly StreamWriter _audit = new StreamWriter("/var/log/audit.txt", append: true);

public void Record(Payment payment)
{
    _audit.WriteLine($"{payment.Id}|{payment.AmountMinor}");
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The writer is never flushed and never disposed</strong>, so up to its buffer size —
        1 KB by default — sits in memory. Measured:</p>
        <pre data-lang="console"><code>   after Write, file size      : 0 bytes
   after Flush, file size      : 27 bytes
   after Dispose, file size    : 27 bytes</code></pre>
        <p>A pod restart is a <code>SIGTERM</code> followed by a <code>SIGKILL</code>. Even a graceful
        shutdown only helps if something disposes the writer; an eviction or an OOM kill does not run
        finalisers at all.</p>
        <p><strong>For an audit log specifically, buffering is the wrong default:</strong></p>
        <pre data-lang="csharp" data-net="10"><code>public sealed class AuditWriter : IAsyncDisposable
{
    private readonly StreamWriter _writer;

    public AuditWriter(string path)
    {
        var stream = new FileStream(path, FileMode.Append, FileAccess.Write,
            FileShare.Read, bufferSize: 4096, FileOptions.Asynchronous);

        _writer = new StreamWriter(stream, new UTF8Encoding(false))
        {
            // Every WriteLine reaches the OS. Slower, and the record exists.
            AutoFlush = true
        };
    }

    public Task RecordAsync(Payment payment) =&gt;
        _writer.WriteLineAsync($"{payment.Id}|{payment.AmountMinor}");

    public async ValueTask DisposeAsync()
    {
        await _writer.FlushAsync().ConfigureAwait(false);
        await _writer.DisposeAsync().ConfigureAwait(false);
    }
}</code></pre>
        <p><strong>The honest trade-off:</strong> <code>AutoFlush</code> costs a syscall per line.
        Reaching the operating system is not the same as reaching the disk either — the OS has its own
        cache, and surviving a machine power loss needs <code>FileOptions.WriteThrough</code> and is
        dramatically slower again.</p>
        <p>Decide which failure you are protecting against: a process crash (flush), or a host failure
        (write-through). They have very different costs.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>You are copying files of unknown size in a service handling many requests at once. Pick a buffer
    size and defend it. Why not 128 KB, and why not 4 KB?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>64 KB, or use <code>CopyTo</code> and get 81,920.</strong></p>
        <pre data-lang="console"><code>   size        total object   generation   syscalls for 16 MB
   ----        ------------   ----------   ------------------
     4,096            4,120   gen 0                     4,096
    65,536           65,560   gen 0                       256
    81,920           81,944   gen 0                       205
   131,072          131,096   gen 2                       128
 1,048,576        1,048,600   gen 2                        16</code></pre>
        <p><strong>Not 4 KB:</strong> 4,096 syscalls for a 16 MB file, and measured 5.15x slower than
        64 KB on a straight copy. The kernel transition dominates.</p>
        <p><strong>Not 128 KB:</strong> it crosses the 85,000-byte large object heap threshold. A
        buffer allocated per request is then born in generation 2 and can only be reclaimed by a full
        collection. It halves the syscalls relative to 64 KB, which by then is no longer the cost — so
        you pay a much worse allocation profile for nothing.</p>
        <p><strong>Why this matters more in a concurrent service:</strong> the buffer is per
        operation. At 100 concurrent copies, 64 KB is 6.4 MB of gen 0 churn and 1 MB buffers would be
        100 MB on the LOH.</p>
        <p><strong>The better answer if the path is hot:</strong> do not allocate per operation at
        all.</p>
        <pre data-lang="csharp" data-net="10"><code>byte[] buffer = ArrayPool&lt;byte&gt;.Shared.Rent(64 * 1024);
try
{
    int read;
    while ((read = await source.ReadAsync(buffer.AsMemory(), cancellationToken)) &gt; 0)
    {
        await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
    }
}
finally
{
    ArrayPool&lt;byte&gt;.Shared.Return(buffer);
}</code></pre>
        <p>Pooling pays at this size — measured elsewhere in this track, the crossover is around a
        kilobyte. And <code>CopyToAsync</code> already does something equivalent internally, so reach
        for it first and only hand-roll when you need to transform as you go.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>A service reads uploaded files and p99 latency climbs badly under load while CPU sits at 30%.
    The read path is below. Diagnose it.</p>
    <pre data-lang="csharp" data-net="10"><code>public async Task&lt;string&gt; ReadUploadAsync(string path)
{
    using var stream = File.OpenRead(path);
    using var reader = new StreamReader(stream);
    return await reader.ReadToEndAsync();
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Two problems, and the latency symptom comes from the first.</strong></p>
        <p><strong>1. The I/O is not asynchronous.</strong> <code>File.OpenRead</code> returns a
        <code>FileStream</code> with a synchronous handle:</p>
        <pre data-lang="console"><code>   File.OpenRead(path)                     IsAsync = False
   FileOptions.Asynchronous                IsAsync = True</code></pre>
        <p>So <code>ReadToEndAsync</code> yields the calling thread and immediately occupies a
        thread-pool thread to do a blocking read. Measured on 60 concurrent readers of a
        20 ms-per-read stream: <strong>7x the elapsed time at the same peak thread count</strong>,
        because the pool queues rather than grows.</p>
        <p>Idle CPU with climbing p99 is the signature — the work is waiting for threads, not for the
        processor.</p>
        <p><strong>2. It holds the whole file.</strong> <code>ReadToEndAsync</code> returns one string,
        so peak memory scales with the upload. Two large uploads at once is twice the peak.</p>
        <pre data-lang="csharp" data-net="10"><code>public async Task ProcessUploadAsync(string path, Func&lt;string, Task&gt; onLine,
    CancellationToken cancellationToken)
{
    await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
        FileShare.Read, bufferSize: 64 * 1024, FileOptions.Asynchronous);

    using var reader = new StreamReader(stream, Encoding.UTF8,
        detectEncodingFromByteOrderMarks: false, bufferSize: 64 * 1024);

    string? line;
    while ((line = await reader.ReadLineAsync(cancellationToken)) is not null)
    {
        await onLine(line);
    }
}</code></pre>
        <p><strong>What to confirm before and after</strong>, from
        <code>dotnet-counters monitor --counters System.Runtime</code>: ThreadPool Queue Length
        sustained above zero is the proof of the diagnosis, and ThreadPool Thread Count climbing
        slowly is the injection rate you are fighting.</p>
        <p>If both are flat and the problem persists, it is not this — check % Time in GC, which
        produces the same symptom for a different reason.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Write a stream decorator that counts bytes and enforces a maximum size, rejecting oversized
    uploads without buffering them. Then list what a decorator must get right.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10"><code>public sealed class LimitedStream : Stream
{
    private readonly Stream _inner;
    private readonly long _maxBytes;
    private readonly bool _leaveOpen;
    private long _read;

    public LimitedStream(Stream inner, long maxBytes, bool leaveOpen = false)
    {
        _inner = inner;
        _maxBytes = maxBytes;
        _leaveOpen = leaveOpen;
    }

    public long BytesRead =&gt; _read;

    public override bool CanRead =&gt; _inner.CanRead;

    public override bool CanSeek =&gt; false;

    public override bool CanWrite =&gt; false;

    public override long Length =&gt; throw new NotSupportedException();

    public override long Position
    {
        get =&gt; throw new NotSupportedException();
        set =&gt; throw new NotSupportedException();
    }

    // The byte[] overload delegates to the span one, so there is a single
    // place where counting and the limit are enforced.
    public override int Read(byte[] buffer, int offset, int count) =&gt;
        Read(buffer.AsSpan(offset, count));

    public override int Read(Span&lt;byte&gt; buffer)
    {
        int read = _inner.Read(buffer);
        Count(read);
        return read;
    }

    public override async ValueTask&lt;int&gt; ReadAsync(Memory&lt;byte&gt; buffer,
        CancellationToken cancellationToken = default)
    {
        int read = await _inner.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        Count(read);
        return read;
    }

    public override Task&lt;int&gt; ReadAsync(byte[] buffer, int offset, int count,
        CancellationToken cancellationToken) =&gt;
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    private void Count(int read)
    {
        // Count what came back, never what was asked for.
        _read += read;

        if (_read &gt; _maxBytes)
        {
            throw new InvalidDataException(
                $"Upload exceeded the {_maxBytes} byte limit");
        }
    }

    public override void Flush() =&gt; _inner.Flush();

    public override long Seek(long offset, SeekOrigin origin) =&gt; throw new NotSupportedException();

    public override void SetLength(long value) =&gt; throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) =&gt; throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing &amp;&amp; !_leaveOpen)
        {
            _inner.Dispose();
        }

        base.Dispose(disposing);
    }
}</code></pre>
        <p><strong>What a decorator must get right, and what happens when it does not:</strong></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Rule</th><th>Consequence of missing it</th></tr></thead>
            <tbody>
              <tr><td>Count what the inner stream <em>returned</em></td><td>Measured: 95 counted against 35 actual. Metrics over-report most on the fragmented connections you would be investigating.</td></tr>
              <tr><td>Override the span and async paths</td><td>Callers reach the base class implementations and bypass you entirely — the limit is not enforced and the count is silently low.</td></tr>
              <tr><td>Route the <code>byte[]</code> overloads to one place</td><td>Two implementations of the rule that drift apart.</td></tr>
              <tr><td>Take a <code>leaveOpen</code> flag</td><td>You dispose a stream the caller still needs, or leak one you owned.</td></tr>
              <tr><td>Report <code>CanSeek</code> honestly</td><td>Callers seek and get wrong data or an exception from the inner stream.</td></tr>
              <tr><td>Throw <em>during</em> the read</td><td>Buffering to check the size first is the exact failure the decorator exists to prevent.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The property that makes this worth writing:</strong> the limit is enforced against a
        stream you never hold. An oversized upload is rejected after one buffer, not after the whole
        thing is in memory.</p>
        <p>Note ASP.NET Core has <code>RequestSizeLimit</code> and <code>MaxRequestBodySize</code> for
        the HTTP case. Write this when the source is not an HTTP request — a partner SFTP drop, a blob
        download, a message payload.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Ledger must transform a partner file — uppercase one column — and write the result. Files range
    from 1 MB to 2 GB. Write it so the 2 GB case works, and say what your version still costs.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>The failing shape and the working one, measured on a 5 MB file:</p>
        <pre data-lang="console"><code>   input file            : 5 MB
   ReadAllLines peak     :    41.5 MB
   streamed peak         :     3.4 MB</code></pre>
        <p>At 2 GB the first version needs tens of gigabytes. The second needs the same 3.4 MB.</p>
        <pre data-lang="csharp" data-net="10"><code>public static async Task TransformAsync(string sourcePath, string destinationPath,
    CancellationToken cancellationToken)
{
    await using var input = new FileStream(sourcePath, FileMode.Open, FileAccess.Read,
        FileShare.Read, bufferSize: 64 * 1024, FileOptions.Asynchronous);

    await using var output = new FileStream(destinationPath, FileMode.Create, FileAccess.Write,
        FileShare.None, bufferSize: 64 * 1024, FileOptions.Asynchronous);

    using var reader = new StreamReader(input, Encoding.UTF8,
        detectEncodingFromByteOrderMarks: false, bufferSize: 64 * 1024);

    // No byte-order mark: another system parses this file.
    await using var writer = new StreamWriter(output,
        new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), bufferSize: 64 * 1024);

    string? line;
    while ((line = await reader.ReadLineAsync(cancellationToken)) is not null)
    {
        await writer.WriteLineAsync(line.AsMemory().ToString().ToUpperInvariant()
            .AsMemory(), cancellationToken);
    }

    // Explicit, so a failure to write surfaces here rather than inside
    // DisposeAsync where it is easy to miss.
    await writer.FlushAsync(cancellationToken);
}</code></pre>
        <p><strong>Four decisions worth defending:</strong></p>
        <ul>
          <li><code>FileOptions.Asynchronous</code> on <em>both</em> streams. Without it the awaits are
          a pool thread blocking on your behalf, and this job would starve the pool it shares.</li>
          <li><code>await using</code>, because <code>StreamWriter</code> has
          <code>DisposeAsync</code>. A plain <code>using</code> compiles and flushes synchronously.</li>
          <li><code>new UTF8Encoding(false)</code>, so no BOM lands in a file another parser reads.</li>
          <li>An explicit <code>FlushAsync</code>, so a write failure — a full disk — throws where you
          can see it.</li>
        </ul>
        <p><strong>What this version still costs, stated plainly:</strong> it allocates per line.
        <code>ReadLineAsync</code> returns a string and <code>ToUpperInvariant</code> returns another.
        For a 2 GB file with 20 million lines that is 40 million short-lived strings.</p>
        <p>They die in generation 0 and never accumulate, so this is an <em>allocation rate</em> cost
        and not a <em>live set</em> cost — it shows up as GC pause time, not as an OOM. That is a real
        cost and a completely different failure from the one the exercise is about, and it is worth
        being able to say which one you have.</p>
        <p><strong>Removing it</strong> means reading UTF-8 bytes and framing lines yourself, which is
        what <code>System.IO.Pipelines</code> exists for and is the next module.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What does <code>Stream.Read</code> actually guarantee?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It returns between 0 and <code>count</code> bytes, and returns 0
        only at the end of the stream. It does <strong>not</strong> guarantee to fill the buffer —
        measured, a request for 35 bytes returned 8.</p></div>
      </details></li>

    <li><p>Which API should you reach for when you know the length?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>ReadExactly</code>. It loops for you and throws
        <code>EndOfStreamException</code> if the stream ends early, so a short stream is a loud failure
        rather than a half-filled buffer.</p></div>
      </details></li>

    <li><p>Why is <code>CopyTo</code>'s default buffer 81,920 bytes?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It sits immediately below the 85,000-byte large object heap threshold, so
        the buffer is collected cheaply in generation 0. A rounder 128 KB would put every buffer on the
        LOH for a syscall saving that no longer matters at that size.</p></div>
      </details></li>

    <li><p>When does <code>BufferedStream</code> help?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>When the stream has no buffer of its own and is accessed in pieces
        smaller than the buffer — measured 1.43x for 512-byte reads. Around a <code>FileStream</code>
        read in 64 KB blocks it measured 1.03x: no win and no measurable loss - a layer doing
        nothing.</p></div>
      </details></li>

    <li><p>Is <code>await stream.ReadAsync(...)</code> on a <code>File.OpenRead</code> stream doing
      asynchronous I/O?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. The handle is synchronous unless opened with
        <code>useAsync: true</code> or <code>FileOptions.Asynchronous</code>, and the default is false.
        The read runs synchronously on a thread-pool thread.</p></div>
      </details></li>

    <li><p>Why does blocking I/O produce a latency cliff rather than adding more threads?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The pool injects threads slowly past its minimum — around one or
        two a second — so within a burst you get a queue rather than more threads. Measured, 60 blocking
        readers took 7x longer than the async equivalent at the <em>same</em> peak thread count.</p>
        <p>The symptom is p99 climbing while CPU is idle.</p></div>
      </details></li>

    <li><p>What is the difference between peak memory and total allocation, and which one killed the
      importer?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Peak is the most live at one instant; total allocation counts
        everything ever created. <strong>Peak killed it</strong> — 157 MB live for a 29 MB file.</p>
        <p>The streamed version still allocated 80 MB in total but never held more than 2.8 MB, so it
        costs GC pause time rather than memory.</p></div>
      </details></li>

    <li><p>Which stream properties must you check before seeking or reading <code>Length</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>CanSeek</code>. Network streams, compression streams and
        pipes cannot seek and throw <code>NotSupportedException</code> from <code>Length</code>. Never
        size a buffer from <code>Length</code> — it fails on a socket and is unbounded on a file.</p></div>
      </details></li>

    <li><p>Your service writes a file and it is empty after a crash. Why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The writer's buffer was never flushed. Measured: zero bytes reached
        the stream until <code>Flush</code>. <code>Dispose</code> flushes, and a killed process never
        runs it.</p></div>
      </details></li>

    <li><p>What must a stream decorator override, beyond <code>Read(byte[], int, int)</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Read(Span&lt;byte&gt;)</code> and
        <code>ReadAsync(Memory&lt;byte&gt;, ...)</code>. Overriding only the array method means span and
        async callers reach the base class implementations and bypass the decorator entirely.</p>
        <p>It must also count what the inner stream <em>returned</em> — measured, counting what was
        asked for gave 95 against an actual 35.</p></div>
      </details></li>
  </ol>
</section>
`
});
