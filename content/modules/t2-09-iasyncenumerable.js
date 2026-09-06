CSPREP.module({
  id: "t2-09-iasyncenumerable",
  minutes: 55,
  updated: "2026-08-31",
  summary: "IAsyncEnumerable<T> is the only shape that streams and does not block, and the difference it makes is structural rather than incremental: 103.8 MB against 0.6 MB, and a first byte at 17 ms rather than 2,761 ms. It is not faster. This module also gives the two arguments against it that recommendations usually omit - the connection is held at the client's pace, and a mid-stream failure is a truncated 200 OK rather than a clean 500.",
  terms: ["IAsyncEnumerable", "IAsyncEnumerator", "await foreach", "async iterator", "streaming",
    "buffering", "yield return", "EnumeratorCancellation", "WithCancellation", "CS8425",
    "ValueTask", "IValueTaskSource", "cold sequence", "time to first byte", "OOMKilled"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger has a CSV export endpoint. It is four lines long and it is how essentially everyone
  writes one:</p>

  <pre data-lang="csharp" data-net="10" data-title="ExportController.cs"><code>var rows = await _repo.GetAllAsync(account, ct);
return File(ToCsv(rows), "text/csv");</code></pre>

  <p>It ran for two years without incident. The largest customer had 40,000 transactions, the
  endpoint used a few megabytes, and nobody thought about it.</p>

  <p>Then a customer was onboarded with two million transactions, and three of their users clicked
  Export within the same minute. The pod was killed by the container runtime. Not slowed —
  <em>killed</em>, along with every other request in flight on that instance, most of which belonged
  to unrelated customers doing unrelated things.</p>

  <p>There was no stack trace, because a container out-of-memory kill does not produce one: the
  kernel stops the process and nothing in .NET gets a chance to run. The only evidence was
  <code>Reason: OOMKilled</code> in the pod description and a memory graph that went vertical.</p>

  <p>The defect is <code>GetAllAsync</code> returning a <code>List&lt;T&gt;</code>. Every row must
  exist in memory simultaneously before the first byte can be written, so memory consumption is a
  linear function of a number the customer controls and you do not. At 40,000 rows that is a few
  megabytes. At two million it was 214 MB per request, against a 512 MB container limit.</p>

  <p>There is a second, quieter cost in the same line. Because nothing can be sent until everything
  is loaded, the client waited <strong>24.6 seconds</strong> before receiving a single byte — long
  enough that a gateway with a 30-second header timeout would have given up first, and the user would
  have seen a failure for a request that was working perfectly.</p>

  <p>This module is about <code>IAsyncEnumerable&lt;T&gt;</code>, the type that removes both
  problems, what it costs, and — importantly, because this is usually left out — the two real
  arguments against using it.</p>
</section>

<section id="plain-language">
  <h2>What an async stream is</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can run. A thread that is waiting for data from a database is occupied and
  doing nothing, which is the cost <code>async</code> exists to avoid.</p>

  <p class="define"><span class="define__term">Buffering</span> Collecting every item into memory
  before returning any of them. <code>Task&lt;List&lt;T&gt;&gt;</code> is a buffered result: the
  caller receives it only when it is complete.</p>

  <p class="define"><span class="define__term">Streaming</span> Producing items one at a time, so the
  consumer can act on the first while the producer is still working on the rest. Memory is bounded by
  what is in flight rather than by the total.</p>

  <p class="define"><span class="define__term">Iterator</span> A method that produces a sequence
  lazily using <code>yield return</code>. The compiler rewrites it into a state machine that runs a
  little further each time the consumer asks for the next item — the same technique as
  <code>async</code>, applied to a sequence instead of a single result.</p>

  <p class="define"><span class="define__term">IAsyncEnumerable&lt;T&gt;</span> A sequence whose items
  arrive asynchronously. It combines the two ideas above: lazy like an iterator, non-blocking like an
  async method. Consumed with <code>await foreach</code>.</p>

  <p><strong>An analogy, and its limits.</strong> Buffering is a removal firm that will not leave your
  old house until every box is on the van. Streaming is a relay of carriers, each taking a box as it
  is packed. The second finishes at roughly the same time, needs a far smaller van, and gets the
  first box to the new house almost immediately.</p>

  <p><strong>Where the analogy breaks:</strong> the relay ties up the road between the two houses for
  the whole journey. In software that road is a database connection, and holding it for the duration
  of a slow client's download is the genuine argument against streaming. The analogy makes streaming
  look free; it is not, and this module measures both sides.</p>

  <h3>Why this needed a new interface</h3>

  <p>C# already had two ways to return a sequence, and neither could do this:</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Shape</th><th>Streams?</th><th>Non-blocking?</th><th>Why not</th></tr></thead>
    <tbody>
      <tr><td><code>Task&lt;List&lt;T&gt;&gt;</code></td><td>No</td><td>Yes</td><td>Must complete before returning anything</td></tr>
      <tr><td><code>IEnumerable&lt;T&gt;</code></td><td>Yes</td><td>No</td><td><code>MoveNext()</code> returns <code>bool</code> — nowhere to put an <code>await</code></td></tr>
      <tr><td><code>IAsyncEnumerable&lt;T&gt;</code></td><td>Yes</td><td>Yes</td><td>—</td></tr>
    </tbody>
  </table>
  </div>

  <p>The whole contribution is the return type of one method:</p>

  <pre data-lang="csharp" data-net="10" data-title="The difference, in one line each"><code>public interface IEnumerator&lt;out T&gt;      { bool            MoveNext();      T Current { get; } }
public interface IAsyncEnumerator&lt;out T&gt; { ValueTask&lt;bool&gt; MoveNextAsync(); T Current { get; } }</code></pre>

  <p><strong>Note that it is <code>ValueTask&lt;bool&gt;</code> rather than
  <code>Task&lt;bool&gt;</code>.</strong> <code>MoveNextAsync</code> is called once per <em>item</em>,
  and usually completes synchronously because the item is already in a page held in memory. Streaming
  200,000 rows in pages of 1,000 means 200,000 calls of which 200 actually wait. With
  <code>Task</code> that would be 200,000 allocations to represent 200 real suspensions. This is the
  exact case <a href="#/m/t2-04-task-and-valuetask">t2-04</a> described, and it is the reason
  <code>ValueTask</code> exists at all.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — the smallest program showing an async stream: values
// arriving one at a time, consumed before the producer has finished.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static async Task Main()
    {
        var sw = Stopwatch.StartNew();

        await foreach (var row in ReadRowsAsync())
            Console.WriteLine($"{sw.ElapsedMilliseconds,5} ms  consumed {row}");

        Console.WriteLine($"{sw.ElapsedMilliseconds,5} ms  done");
    }

    // async + IAsyncEnumerable&lt;T&gt; + yield return. No List, no Task&lt;List&gt;.
    static async IAsyncEnumerable&lt;string&gt; ReadRowsAsync(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var i = 1; i &lt;= 3; i++)
        {
            await Task.Delay(100, ct).ConfigureAwait(false);   // a page arrives
            yield return $"row-{i}";
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>  119 ms  consumed row-1
  236 ms  consumed row-2
  337 ms  consumed row-3
  338 ms  done</code></pre>

  <p>The timestamps are the entire point. The consumer handled <code>row-1</code> at 119 ms, while
  the producer had not yet begun fetching <code>row-2</code>. A buffered version would have printed
  nothing until 337 ms and then all three at once.</p>

  <p><strong>Three keywords make an async iterator</strong>, and all three are required:
  <code>async</code>, a return type of <code>IAsyncEnumerable&lt;T&gt;</code>, and
  <code>yield return</code>. There is no <code>return</code> statement anywhere in the method — you
  never construct the sequence, you describe how to produce it.</p>

  <p><strong><code>await foreach</code> is not <code>foreach</code> with an <code>await</code>
  inside.</strong> It is a distinct construct that compiles to roughly this:</p>

  <pre data-lang="csharp" data-net="10" data-title="What await foreach compiles to"><code>var e = source.GetAsyncEnumerator(ct);
try
{
    while (await e.MoveNextAsync())
        Handle(e.Current);
}
finally
{
    await e.DisposeAsync();
}</code></pre>

  <p>Two details in that matter later. The disposal is <em>asynchronous</em> and sits in a
  <code>finally</code>, so breaking out of the loop still closes whatever the producer is holding.
  And <code>Current</code> is a plain property, never a <code>Task</code> — the <code>await</code> is
  on <em>advancing</em>, not on reading a value you already have.</p>
</section>

<section id="what-it-buys">
  <h2>What it buys, measured</h2>

  <p>200,000 rows of 512 bytes, arriving in pages of 1,000, each page costing 2 ms of I/O:</p>

  <pre data-lang="console" data-title="01-streaming.cs"><code>  shape                              peak MB   first item ms   total ms
  Task&lt;List&lt;T&gt;&gt;   (buffer all)        103.8           2,761      2,766
  IEnumerable&lt;T&gt;  (sync stream)         2.4               6      2,836
  IAsyncEnumerable&lt;T&gt; (stream)          0.6              17      2,851</code></pre>

  <p><strong>Memory: 103.8 MB against 0.6 MB.</strong> That ratio is structural rather than
  incidental — it does not depend on how fast anything is, and it grows with the row count in the
  buffered case and does not in the streaming case.</p>

  <p><strong>Time to first item: 2,761 ms against 17 ms.</strong> Buffering cannot emit anything
  until it has produced everything. For an HTTP response, a UI, or anything with a timeout in front
  of it, this is the number a user experiences.</p>

  <p><strong>Total time: effectively identical.</strong> This is the honest result and it is worth
  stating plainly: <strong>streaming is not faster.</strong> It changes the memory profile and the
  latency profile. It does not reduce the work.</p>

  <p>The middle row is the one that explains why the interface had to be added.
  <code>IEnumerable&lt;T&gt;</code> streams perfectly well and its memory column is fine. Its problem
  is invisible in this table: to fetch each page it must <strong>block</strong>, because
  <code>MoveNext()</code> returns <code>bool</code> and there is nowhere in that signature to put an
  <code>await</code>. So before C# 8 the choice was to stream and block a thread per consumer, or to
  go async and buffer everything — and given
  <a href="#/m/t2-02-thread-pool">what blocking costs the thread pool</a>, most people correctly
  chose to buffer, which is how this shape became the default.</p>

  <h3>The generated type</h3>

  <pre data-lang="console" data-title="01-streaming.cs"><code>  generated type : &lt;StreamRowsAsync&gt;d__6
  is a struct    : False
  implements     : IAsyncDisposable
  implements     : IAsyncEnumerable&amp;#96;1
  implements     : IAsyncEnumerator&amp;#96;1
  implements     : IAsyncStateMachine
  implements     : IValueTaskSource
  implements     : IValueTaskSource&amp;#96;1</code></pre>

  <p>Compare with <a href="#/m/t2-05-async-state-machine">t2-05</a>, where the async state machine was
  a <code>struct</code>. Here it is a <strong>class</strong>, because an iterator must survive between
  calls to <code>MoveNextAsync</code> from the very first one — there is no synchronous fast path
  where it could live on the stack, so there is nothing to gain by starting it there.</p>

  <p>It implements both <code>IAsyncEnumerable</code> and <code>IAsyncEnumerator</code>: the first
  call to <code>GetAsyncEnumerator</code> hands back the object itself, and only a second concurrent
  enumeration allocates another. Enumerating once — the normal case — costs one object.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><code>IValueTaskSource</code> in that list is the pooling mechanism
    <a href="#/m/t2-04-task-and-valuetask">t2-04</a> described. Rather than allocating a
    <code>Task</code> for each <code>MoveNextAsync</code> that suspends, the state machine
    <em>is</em> the backing source for its own <code>ValueTask</code>, reused across every item. That
    is how a 200,000-item stream costs a fraction of a megabyte.</p>
    <p>It also means the <code>ValueTask</code> consumption rules from t2-04 are not optional here.
    Awaiting the <code>ValueTask</code> returned by <code>MoveNextAsync</code> twice, or storing it,
    reads an object that has already been recycled for the next item. <code>await foreach</code> gets
    this right; hand-rolled enumeration is where it goes wrong.</p>
  </div>
</section>

<section id="cancellation">
  <h2>Cancellation, and the attribute that gets omitted</h2>

  <p>An async <em>method</em> is called once, so its token parameter is the only way in. An async
  <em>stream</em> has two entry points, and they can happen at different times with different
  tokens:</p>

  <pre data-lang="csharp" data-net="10" data-title="Two places a token can arrive"><code>var stream = repo.StreamAsync(account, ct);        // 1. the call
await foreach (var row in stream.WithCancellation(other))   // 2. the enumeration</code></pre>

  <p>Creating the stream runs none of it — nothing happens until the first
  <code>MoveNextAsync</code> — so the token that usually matters is the one supplied at enumeration.
  That is the one a controller has when a repository handed it a sequence.</p>

  <p class="define"><span class="define__term">EnumeratorCancellation</span> An attribute placed on an
  async iterator's <code>CancellationToken</code> parameter. It instructs the compiler to route the
  token supplied to <code>GetAsyncEnumerator</code> — which is what <code>WithCancellation</code>
  sets — into that parameter. Without it, the parameter is never assigned from that source.</p>

  <p class="define"><span class="define__term">WithCancellation</span> An extension method that
  supplies a token to the enumeration rather than to the call. It does not itself cancel anything; it
  passes the token to <code>GetAsyncEnumerator</code>, and whether that reaches your producer depends
  entirely on the attribute above.</p>

  <pre data-lang="console" data-title="02-cancellation.cs — 100 items available, cancelled after 60 ms"><code>  producer                              items produced   stopped after
  no attribute, WithCancellation                  100        1,572 ms
  [EnumeratorCancellation], With                    5           80 ms
  no attribute, token at CALL                       5           72 ms</code></pre>

  <p><strong>Row 1 is the bug.</strong> A token was supplied, the token was cancelled, and the
  producer ran to completion — because without the attribute the compiler has no instruction to route
  it, so the producer's own parameter stayed <code>default(CancellationToken)</code>, which can never
  fire. <code>WithCancellation</code> was silently a no-op.</p>

  <p>Row 3 shows that passing the token at the call also works, which raises the obvious question:
  why does the attribute exist? Because the consumer frequently <em>cannot</em> do that. A repository
  returns <code>IAsyncEnumerable&lt;Invoice&gt;</code> and a controller enumerates it; by then the
  call has already happened and <code>WithCancellation</code> is the only option available.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>The compiler warns about this, and the warning is quiet enough to lose.</strong> Building an
    async iterator that takes a token without the attribute produces:</p>
    <pre data-lang="console" data-title="CS8425"><code>warning CS8425: Async-iterator 'Repo.StreamAsync(CancellationToken)' has one or more
parameters of type 'CancellationToken' but none of them is decorated with the
'EnumeratorCancellation' attribute, so the cancellation token parameter from the
generated 'IAsyncEnumerable&lt;&gt;.GetAsyncEnumerator' will be unconsumed</code></pre>
    <p>Treat it as an error. It is one of very few cases where the compiler detects a purely semantic
    mistake about cancellation rather than a type error.</p>
    <p><strong>Its blind spot:</strong> it fires only when a token parameter already exists. An async
    iterator with no token at all is completely uncancellable and warns about nothing — so adding the
    parameter remains your job, and no tool will remind you.</p>
  </div>

  <p>When a token is supplied in <em>both</em> places, the compiler links them for you:</p>

  <pre data-lang="console" data-title="02-cancellation.cs"><code>  call token cancels first  : stopped after 61 ms
  enum token cancels first  : stopped after 62 ms</code></pre>

  <p>Either stops the producer. This is the one place in .NET where linking happens automatically —
  worth knowing so that you do not build a second linked source
  (<a href="#/m/t2-08-cancellation">t2-08</a>) on top of the one the compiler already made.</p>

  <h3>Cleanup</h3>

  <p>A stream usually holds something that must be released — a database reader, a file handle, a
  connection. Cancelling must not leak it, and it does not:</p>

  <pre data-lang="console" data-title="02-cancellation.cs"><code>  cancelled mid-stream, cleanup ran : True</code></pre>

  <p>Because <code>await foreach</code> compiles its <code>DisposeAsync</code> call into a
  <code>finally</code>, breaking, returning or throwing out of the loop all resume your iterator at
  its own <code>finally</code> block. This is why <code>await using</code> inside an async iterator is
  safe and is the correct way to hold a connection open across a stream.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>That guarantee belongs to <code>await foreach</code>, not to the type. Enumerating manually
    without disposing leaves the iterator suspended permanently:</p>
    <pre data-lang="console" data-title="02-cancellation.cs"><code>  manual enumeration, no dispose, cleanup ran : False</code></pre>
    <p>An async iterator has <strong>no finaliser</strong>, so the <code>finally</code> may never run
    at all — the connection, file handle or lock it holds is held until the process exits. Use
    <code>await foreach</code>. If you must enumerate by hand, wrap the enumerator in
    <code>await using</code>.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>The Ledger export from the opening, both ways:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>/// &lt;summary&gt;Stands in for the transactions table, which returns rows in pages.&lt;/summary&gt;
public sealed class TransactionRepository
{
    private const int PageSize = 1_000;
    private readonly int _total;
    private int _rowsFetched;

    public TransactionRepository(int total) =&gt; _total = total;
    public int RowsFetched =&gt; Volatile.Read(ref _rowsFetched);
    public void Reset() =&gt; Volatile.Write(ref _rowsFetched, 0);

    /// &lt;summary&gt;THE SHIPPED VERSION. Materialises every row before returning.&lt;/summary&gt;
    public async Task&lt;List&lt;Transaction&gt;&gt; GetAllAsync(string account, CancellationToken ct = default)
    {
        var all = new List&lt;Transaction&gt;();
        for (var offset = 0; offset &lt; _total; offset += PageSize)
        {
            await Task.Delay(1, ct).ConfigureAwait(false);
            for (var i = 0; i &lt; PageSize &amp;&amp; offset + i &lt; _total; i++)
            {
                all.Add(NewRow(offset + i));
                Interlocked.Increment(ref _rowsFetched);
            }
        }
        return all;
    }

    /// &lt;summary&gt;THE FIX. One page in memory at a time, and cancellable throughout.&lt;/summary&gt;
    public async IAsyncEnumerable&lt;Transaction&gt; StreamAsync(
        string account, [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var offset = 0; offset &lt; _total; offset += PageSize)
        {
            await Task.Delay(1, ct).ConfigureAwait(false);
            for (var i = 0; i &lt; PageSize &amp;&amp; offset + i &lt; _total; i++)
            {
                Interlocked.Increment(ref _rowsFetched);
                yield return NewRow(offset + i);
            }
        }
    }

    private static Transaction NewRow(int i) =&gt;
        new(i, $"TX-{i:D9}", 10.00m + i % 500, new DateOnly(2026, 1, 1).AddDays(i % 365));
}</code></pre>

  <pre data-lang="console" data-title="03-production.cs"><code>  account size    buffered MB   streamed MB   buffered TTFB   streamed TTFB
        40,000           4.9           4.0             483               8
       400,000          45.7           0.9           4,917               5
     2,000,000         214.4           1.3          24,591              14</code></pre>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>The streamed memory column measures the heap after the run without forcing a collection, so it
    includes uncollected garbage rather than only retained data — which is why the first streamed row
    reads higher than the later ones despite holding less. The signal is that it does
    <strong>not grow with account size</strong>, not the absolute figure. The buffered column is
    retained data and is the one to read literally.</p>
  </div>

  <p>The buffered column is linear in row count, which is the whole problem: it is bounded by nothing
  the service controls. Against a 512 MB container limit, three concurrent exports of the two-million
  row account exceed it between them, and the pod is killed — taking every unrelated request on that
  instance with it.</p>

  <p>The fix is a different return type and one changed loop:</p>

  <pre data-lang="csharp" data-net="10" data-title="The endpoint, streaming"><code>[HttpGet("accounts/{account}/transactions.csv")]
public async Task ExportAsync(string account, CancellationToken ct)
{
    Response.ContentType = "text/csv";
    await using var writer = new StreamWriter(Response.Body);

    await writer.WriteLineAsync("Id,Reference,Amount,Date");
    await foreach (var tx in _repo.StreamAsync(account, ct))
    {
        ct.ThrowIfCancellationRequested();
        await writer.WriteLineAsync($"{tx.Id},{tx.Reference},{tx.Amount},{tx.Date:O}");
    }
}</code></pre>

  <h3>What streaming does not fix</h3>

  <p>This is usually left out of the recommendation, and all three of these are real.</p>

  <p><strong>1. Total time is unchanged.</strong> Streaming moves work around; it does not remove it.
  A two-million-row export still takes as long as it takes — 2,851 ms against 2,766 ms in the
  benchmark, which is marginally <em>worse</em>.</p>

  <p><strong>2. The database connection is now held for the whole response.</strong> A buffered read
  finishes its query and releases the connection, then writes to the client. A streamed one holds the
  connection open at the <em>client's</em> pace, so a slow mobile connection now occupies a slot in
  your connection pool. On a pool of 100 with slow clients, buffering can genuinely be the more
  scalable choice. This is the strongest argument against streaming and it is rarely mentioned.</p>

  <p><strong>3. You cannot change the status code once you have started writing.</strong> Which
  produces a failure mode that only exists when streaming:</p>

  <pre data-lang="console" data-title="03-production.cs — a reader failure at row 30,000"><code>  buffered, throws at row 30,000 : threw before writing anything -&gt; clean 500
  streamed, throws at row 30,000 : already sent 200 OK and 30,000 rows -&gt; truncated file</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The buffered version fails cleanly: nothing was written, so the client gets a 500 and knows the
    export failed. The streamed version has already sent <code>200 OK</code> and 30,000 valid rows.
    All it can do is stop writing.</p>
    <p><strong>The client receives a successful response containing a well-formed CSV missing 40% of
    its data, with nothing to indicate truncation.</strong> That is worse than an error, because it
    will be loaded, reconciled against, and believed. In a payments system it produces a discrepancy
    that takes days to trace back to a transport-layer failure nobody logged.</p>
    <p>Mitigations, in descending order of how much they actually help: write a <strong>trailer</strong>
    (a row count or checksum) that the consumer verifies — the only one that fully works; use a
    documented terminator; validate everything you can before the first <code>yield</code>; and log
    truncations loudly, because your metrics are the only place the failure exists at all.</p>
  </div>

  <h3>How it was diagnosed</h3>

  <pre data-lang="console" data-title="Finding a buffering problem"><code>kubectl describe pod ledger-api-7d4f     -&gt;  Reason: OOMKilled

dotnet-counters monitor --process-id 4812 System.Runtime
    gc-heap-size      spikes to the limit, then the pod dies
    gen-2-gc-count    rising sharply immediately before
    alloc-rate        very high during a single request

dotnet-gcdump collect --process-id 4812     (during, not after)
    -&gt; one List&lt;Transaction&gt; with millions of entries, rooted by a request handler</code></pre>

  <p><strong>The distinguishing signature is worth memorising: memory correlates with request
  <em>size</em> rather than with request <em>count</em>.</strong> A leak grows with total requests
  served and never falls. This spikes on one request and returns to normal afterwards. That single
  distinction tells you to look for buffering rather than for a leak, and it is the fastest way to
  separate the two.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Materialising the stream immediately</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: undoes the entire benefit"><code>// WRONG. ToListAsync buffers everything, so this has exactly the memory
// profile the streaming version was written to avoid.
var rows = await _repo.StreamAsync(account, ct).ToListAsync(ct);
return File(ToCsv(rows), "text/csv");

// Right: consume it as a stream.
await foreach (var tx in _repo.StreamAsync(account, ct))
    await writer.WriteLineAsync(ToCsvLine(tx));</code></pre>

  <p>This happens most often when a streaming repository method is introduced under an unchanged
  caller. The signature improves, the memory does not, and the change is recorded as done.</p>

  <h3>2. Omitting <code>[EnumeratorCancellation]</code></h3>

  <p>Measured: 100 items produced against 5, with a cancelled token in hand. CS8425 catches it —
  provided the parameter exists at all and nobody has suppressed the warning.</p>

  <h3>3. Enumerating twice without meaning to</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: two round trips to the database"><code>// WRONG. Each enumeration re-runs the producer, so this queries twice.
var stream = _repo.StreamAsync(account, ct);
var count = await stream.CountAsync(ct);          // enumeration 1
await foreach (var tx in stream) Write(tx);       // enumeration 2

// Right: decide once. Either buffer, or stream and count as you go.
var written = 0;
await foreach (var tx in _repo.StreamAsync(account, ct)) { Write(tx); written++; }</code></pre>

  <p>An <code>IAsyncEnumerable&lt;T&gt;</code> is <em>cold</em>: it is a recipe, not a result. This is
  the same trap as <a href="#/m/t1-25-deferred-execution">deferred LINQ execution</a>, and it is
  worse here because each replay is a network round trip rather than a re-filter of a list.</p>

  <h3>4. Holding a lock or a transaction across the yield</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the lock is held at the consumer's pace"><code>// WRONG. The semaphore is held for the entire enumeration, which is as long as
// the CONSUMER takes — potentially the duration of a slow client's download.
await _gate.WaitAsync(ct);
try
{
    await foreach (var row in ReadAsync(ct))
        yield return row;
}
finally { _gate.Release(); }</code></pre>

  <p>A <code>yield return</code> hands control to the consumer and does not get it back until they ask
  for the next item. Anything held across that boundary is held for a duration you do not control.
  This is the same hazard as the connection-lifetime point above, and it applies to locks,
  transactions and rented buffers alike.</p>

  <h3>5. Assuming an exception can still change the response</h3>

  <p>Once the first item has been written, the status code is sent. Validate before the first
  <code>yield</code>, and use a trailer so the consumer can detect truncation.</p>

  <h3>6. Enumerating manually and not disposing</h3>

  <p>Measured: the <code>finally</code> never ran. Async iterators have no finaliser, so this is not
  merely late cleanup — it may be no cleanup at all.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a pod restarts with no exception and no stack trace, under load that
    is normal in request count.</p>
    <p><strong>Why:</strong> a container out-of-memory kill. The kernel stops the process; .NET never
    gets to run, so there is nothing in your logs.</p>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="Confirming an OOM kill"><code>kubectl describe pod &lt;pod&gt; | grep -A3 "Last State"
    Reason:  OOMKilled
    Exit Code: 137</code></pre>
    <p><strong>Reading it:</strong> exit code 137 is 128 + 9, meaning the process was killed by
    SIGKILL. Combined with <code>OOMKilled</code> this rules out application-level faults entirely —
    do not go looking for an exception, because there was not one.</p>
    <p><strong>Fix:</strong> find what is proportional to request size. A buffered result set is the
    first candidate.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> memory spikes hard and then recovers, rather than climbing steadily.</p>
    <p><strong>Why:</strong> this is the shape that separates <em>buffering</em> from a
    <em>leak</em>, and getting it right saves days.</p>
    <pre data-lang="console" data-title="Two different shapes"><code>buffering : spikes with a single large request, returns to baseline after
            correlates with request SIZE
            unaffected by how many requests you have served

leak      : climbs steadily, never falls
            correlates with request COUNT
            unaffected by load dropping to zero</code></pre>
    <p><strong>Fix:</strong> for the first, stream. For the second, see the retained-registration
    hunt in <a href="#/m/t2-08-cancellation">t2-08</a>.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you need to know what is holding the memory, not merely that
    something is.</p>
    <p><strong>Tool:</strong> capture while it is happening, not afterwards — the evidence is gone by
    the time the request completes:</p>
    <pre data-lang="console" data-title="Finding the buffer"><code>dotnet-gcdump collect --process-id 4812
# then in the analysis, sort by retained size and look for:
#   List&lt;T&gt; or T[] with a very large element count
#   rooted by a request handler or controller frame</code></pre>
    <p><strong>Reading it:</strong> one enormous collection rooted by a single request is buffering.
    Many small objects rooted by a long-lived service is a leak. The root path is the diagnosis, not
    the size.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> cancelling a stream has no effect, or a client disconnect does not
    stop the query.</p>
    <p><strong>Tool:</strong> the compiler, first — <code>CS8425</code> is emitted at build time and
    is frequently buried in build output. Then a test that asserts on work done:</p>
    <pre data-lang="csharp" data-net="10" data-title="Testing that a stream actually stops"><code>[Fact]
public async Task StreamAsync_StopsFetching_WhenTheConsumerCancels()
{
    var repo = new TransactionRepository(100_000);
    using var cts = new CancellationTokenSource();

    var seen = 0;
    await Assert.ThrowsAsync&lt;OperationCanceledException&gt;(async () =&gt;
    {
        await foreach (var _ in repo.StreamAsync("ACC-1").WithCancellation(cts.Token))
            if (++seen == 10) cts.Cancel();
    });

    Assert.True(repo.RowsFetched &lt; 100_000,
        $"fetched {repo.RowsFetched} rows after cancelling at 10");
}</code></pre>
    <p><strong>Reading it:</strong> as in <a href="#/m/t2-08-cancellation">t2-08</a>, the assertion on
    rows fetched is the load-bearing one. Asserting only that it threw passes against a producer that
    kept fetching.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Buffering makes your memory usage a function of your customers' data, not your
    traffic.</strong> The Ledger endpoint used 4.9 MB for the largest account it had ever seen and
    214.4 MB for the account onboarded two years later — no deployment, no code change, no increase
    in request rate. Capacity planning based on requests per second cannot predict this, which is why
    it survives load testing and appears the week a big customer signs.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Time to first byte decides whether a gateway believes you are alive.</strong> The
    buffered two-million-row export produced nothing for 24.6 seconds. Load balancers and API
    gateways commonly time out response headers at 30 seconds and connections at 60. A request that
    would have succeeded in 25 seconds is killed at 30 having produced no output, and the client
    retries — starting a second 214 MB buffer alongside the first. Streaming sent its first byte at
    14 ms, so the connection is alive from the start and the export finishes.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The streaming failure mode is a data-integrity problem, not an availability
    one.</strong> A reader failure at row 30,000 of 50,000 produced a <code>200 OK</code> with a
    well-formed CSV missing 40% of its rows. In a payments system that file is imported and
    reconciled against, and the discrepancy surfaces days later as a finance question rather than an
    engineering alert. This is the price of streaming and it is payable: a trailer row with a
    checksum costs one line and converts a silent corruption into a loud failure. Streaming without
    one trades an outage you would notice for a data error you would not.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Streaming is faster."</strong> Measured at 2,851 ms against 2,766 ms — marginally
    slower. It changes <em>when</em> the first item arrives and <em>how much</em> memory is held. It
    does not reduce total work, and expecting throughput gains from it leads to disappointment.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>IAsyncEnumerable&lt;T&gt;</code> is <code>IEnumerable&lt;T&gt;</code> with
    async."</strong> Closer to true than most such claims, but the addition is precisely the thing
    that could not be retrofitted: <code>MoveNextAsync</code> returns
    <code>ValueTask&lt;bool&gt;</code>, so advancing can suspend. That single signature change is why
    a new interface was needed rather than an extension method.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Passing a <code>CancellationToken</code> to the method makes the stream
    cancellable."</strong> Only for consumers who call the method themselves. A consumer handed the
    sequence can supply a token only via <code>WithCancellation</code>, which reaches your parameter
    only through <code>[EnumeratorCancellation]</code>. Measured: 100 items produced against 5.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Calling the method starts the work."</strong> It starts none of it — verified: zero
    items produced after the call, two after consuming two. Unlike a normal async method, which is
    <em>hot</em> (<a href="#/m/t2-04-task-and-valuetask">t2-04</a>), an async iterator is
    <strong>cold</strong>. Nothing runs until the first <code>MoveNextAsync</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Enumerating it twice reads a cached result."</strong> It re-runs the producer.
    Verified: six items produced from a three-item stream enumerated twice. Against a database that
    is two queries, and nothing in the type warns you.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Always stream."</strong> Streaming holds the database connection for the whole
    response, at the client's pace. On a 100-connection pool serving slow clients, buffering a small
    bounded result is the more scalable choice — and buffering can fail with a clean status code,
    which streaming cannot. "Always stream" is as wrong as "always buffer"; the deciding question is
    whether the result size is bounded by something you control.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The <code>finally</code> in my iterator always runs."</strong> Only if the enumerator
    is disposed. <code>await foreach</code> always disposes; manual enumeration frequently does not,
    and an async iterator has <strong>no finaliser</strong> — verified: the cleanup never ran.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <p>Every answer below is produced by running <code>04-exercises.cs</code>, included in full at the
  end of the module.</p>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>How many items has this produced immediately after the call, and after consuming two?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>var stream = Counting(5);        // how many produced now?
await Consume(stream, take: 2);  // and now?</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  after calling the method     : 0 produced
  after consuming 2 items      : 2 produced</code></pre>
        <p><strong>Zero, then exactly two.</strong> Calling an async iterator runs none of its body —
        it constructs the state machine and returns.</p>
        <p>This is the opposite of a normal async method. A <code>Task</code> is <em>hot</em>: calling
        the method starts the work and it proceeds whether or not you await
        (<a href="#/m/t2-04-task-and-valuetask">t2-04</a>). An <code>IAsyncEnumerable&lt;T&gt;</code>
        is <em>cold</em>: it is a description of how to produce items, and stopping early means the
        rest never happens.</p>
        <p>That coldness is what makes early termination cheap — <code>break</code> after two items of
        a million-item stream costs two items — and it is also what makes accidental double
        enumeration expensive.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>A three-item stream is enumerated twice. How many items are produced in total?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  enumerated twice, produced   : 6 items</code></pre>
        <p><strong>Six.</strong> Each enumeration calls <code>GetAsyncEnumerator</code> and runs the
        producer again from the start.</p>
        <p>This mirrors <a href="#/m/t1-25-deferred-execution">deferred LINQ execution</a>, and the
        consequence is more serious here: each replay is a network round trip rather than a re-filter
        of an in-memory list. Code like</p>
        <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Two queries"><code>var count = await stream.CountAsync(ct);
await foreach (var tx in stream) Write(tx);</code></pre>
        <p>queries the database twice, and nothing in the type system objects. If you need the data
        more than once, materialise deliberately with <code>ToListAsync</code> and accept the memory
        — or restructure so one pass is enough.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Both of these are given a token that is cancelled after 60 ms. One stops. Which, and why?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>static async IAsyncEnumerable&lt;int&gt; A(CancellationToken ct = default) { ... }

static async IAsyncEnumerable&lt;int&gt; B(
    [EnumeratorCancellation] CancellationToken ct = default) { ... }

// consumed identically:
await foreach (var v in X().WithCancellation(token)) { }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  producer                              items   stopped after
  no attribute + WithCancellation         100        1,570 ms
  [EnumeratorCancellation] + With           5           80 ms</code></pre>
        <p><strong>Only <code>B</code> stops.</strong> <code>WithCancellation</code> supplies its token
        to <code>GetAsyncEnumerator</code>. Without the attribute, the compiler has no instruction to
        route that anywhere, so <code>A</code>'s <code>ct</code> parameter remains
        <code>default(CancellationToken)</code> — a token that can never be cancelled. The call
        compiles, runs, and silently ignores cancellation entirely.</p>
        <p><strong>The compiler does warn:</strong> <code>CS8425</code> fires on any async iterator
        with a token parameter and no attribute. Treat it as an error.</p>
        <p><strong>Its blind spot matters too:</strong> it only fires when the parameter exists. An
        async iterator with no <code>CancellationToken</code> at all is completely uncancellable and
        produces no warning of any kind, because there is nothing for the compiler to notice.</p>
        <p>The rule: every async iterator takes a <code>CancellationToken</code>, and every such
        parameter carries <code>[EnumeratorCancellation]</code>. It costs nothing when unused.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>An async iterator holds a database connection and releases it in a <code>finally</code>. Does
    the <code>finally</code> run if the consumer stops early?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  await foreach, break at 3    : True
  manual enumeration, no dispose: False</code></pre>
        <p><strong>It depends entirely on how the consumer enumerates.</strong></p>
        <p><code>await foreach</code> compiles the <code>DisposeAsync</code> call into a
        <code>finally</code>, so <code>break</code>, <code>return</code> and <code>throw</code> all
        cause the enumerator to be disposed, which resumes your iterator at its own
        <code>finally</code>. The connection is released.</p>
        <p>Manual enumeration without disposing leaves the iterator suspended at its
        <code>yield return</code> permanently. <strong>An async iterator has no finaliser</strong>, so
        this is not late cleanup — it may be no cleanup, ever. The connection is held until the
        process exits.</p>
        <p>The practical rules: use <code>await foreach</code>; if you must enumerate by hand, use
        <code>await using var e = source.GetAsyncEnumerator(ct);</code>; and prefer
        <code>await using</code> <em>inside</em> the iterator for the resource itself, so that
        disposal is expressed once rather than depending on a <code>finally</code> you might
        forget.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Given the measurements, write down the decision rule: when do you stream and when do you
    buffer? Include at least two cases where buffering is correct.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  approach     retained MB   first item ms   total ms
  buffer           103.7           3,185      3,185
  stream             0.0               8        3,235</code></pre>
        <p><strong>Stream when</strong> the result size is unbounded or controlled by the caller; the
        consumer can act on the first item; you are writing to a response body, a file or a socket; or
        time to first byte matters because something upstream has a timeout.</p>
        <p><strong>Buffer when</strong> the set is small and bounded by something you control; you
        need it more than once; you need its count or any aggregate before emitting; <strong>you must
        be able to fail with a clean status code</strong>; or <strong>you want the database connection
        released as early as possible</strong>.</p>
        <p>Those last two are the ones people miss, and they are the strongest arguments for
        buffering.</p>
        <p><strong>On failure:</strong> a buffered handler that fails has written nothing and can
        return a 500. A streaming handler that fails has already sent <code>200 OK</code> and a valid
        prefix — measured at 30,000 of 50,000 rows — producing a file that looks complete and is not.
        If the consumer reconciles against that file, silent truncation is worse than an outage.</p>
        <p><strong>On connections:</strong> buffering holds the connection for the query; streaming
        holds it for the whole response, at the client's pace. A 100-connection pool serving slow
        mobile clients can be exhausted by streaming a result that buffering would have handled
        comfortably.</p>
        <p><strong>The synthesis:</strong> stream when the size is unbounded, because there memory is
        a correctness problem and nothing else will save you. Buffer when the size is bounded and you
        want clean failure semantics and short connection holds. The question to ask is not "which is
        better" but "is the row count bounded by something I control?"</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A service's memory spikes to the container limit on some requests and is normal on others.
    Request rate is flat. Is this a leak? How do you tell, and what do you capture?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Not a leak — the shape rules it out.</strong> The two are distinguishable before
        you capture anything:</p>
        <pre data-lang="console" data-title="Two shapes"><code>buffering : spikes with a single large request, returns to baseline after
            correlates with request SIZE
            unaffected by how many requests you have served

leak      : climbs steadily, never falls
            correlates with request COUNT
            unaffected by load dropping to zero</code></pre>
        <p>Memory that <em>returns to baseline</em> is not leaked; it is held transiently by something
        proportional to one request. That points at a buffered result set.</p>
        <p><strong>What to capture, and when:</strong></p>
        <pre data-lang="console" data-title="Capturing the evidence"><code>kubectl describe pod &lt;pod&gt;      # confirm OOMKilled, exit code 137
dotnet-counters monitor --process-id &lt;pid&gt; System.Runtime
dotnet-gcdump collect --process-id &lt;pid&gt;    # DURING a large request</code></pre>
        <p>The timing is the hard part: capture after the request completes and the evidence has
        already been collected. Trigger the capture from the size signal — a large account, a long
        date range — rather than waiting for the spike.</p>
        <p><strong>What confirms it:</strong> in the gcdump, one <code>List&lt;T&gt;</code> or array
        with a very large element count, rooted by a request handler frame. Contrast with a leak,
        which shows many small objects rooted by a long-lived singleton. <strong>The root path is the
        diagnosis, not the size.</strong></p>
        <p><strong>Why the OOM kill produced no stack trace:</strong> the kernel sends SIGKILL and the
        process stops immediately. No .NET exception is raised, no handler runs, nothing is logged.
        Exit code 137 (128 + 9) plus <code>OOMKilled</code> is the whole record, and looking for an
        exception wastes the first hour of the investigation.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 01-streaming.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-streaming.cs"><code>// 01-streaming.cs — what IAsyncEnumerable&lt;T&gt; buys, measured: peak memory and
// time to the FIRST item, against the two things people write instead.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-streaming.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Rows = 200_000;
    const int RowBytes = 512;

    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the three shapes ===");
        Console.WriteLine();
        Console.WriteLine("  Reading 200,000 rows of 512 bytes from a source that arrives in");
        Console.WriteLine("  pages of 1,000, with each page costing 2 ms of I/O.");
        Console.WriteLine();
        Console.WriteLine("  shape                              peak MB   first item ms   total ms");

        Measure("Task&lt;List&lt;T&gt;&gt;   (buffer all)", () =&gt; ConsumeBuffered());
        Measure("IEnumerable&lt;T&gt;  (sync stream)", () =&gt; ConsumeSyncStream());
        Measure("IAsyncEnumerable&lt;T&gt; (stream)", () =&gt; ConsumeAsyncStream());

        Console.WriteLine();
        Console.WriteLine("  Read the columns in order, because they say different things.");
        Console.WriteLine();
        Console.WriteLine("  PEAK MB. Buffering holds every row at once. Streaming holds one row");
        Console.WriteLine("  and one page. That difference does not depend on how fast anything");
        Console.WriteLine("  is; it is structural, and it is the reason the type exists.");
        Console.WriteLine();
        Console.WriteLine("  FIRST ITEM MS. Buffering cannot produce anything until it has");
        Console.WriteLine("  produced everything. Streaming yields the first row after the first");
        Console.WriteLine("  page. For an HTTP response or a UI, that is the number a user feels.");
        Console.WriteLine();
        Console.WriteLine("  TOTAL MS. Roughly the same for all three, and that is the honest");
        Console.WriteLine("  result: streaming is not FASTER. It changes the memory profile and");
        Console.WriteLine("  the latency profile, not the throughput.");

        Console.WriteLine();
        Console.WriteLine("=== why the synchronous stream is not the answer ===");
        Console.WriteLine();
        Console.WriteLine("  IEnumerable&lt;T&gt; streams too, and its memory column matches. The");
        Console.WriteLine("  problem is invisible in this table: to fetch each page it must BLOCK,");
        Console.WriteLine("  because MoveNext() returns bool rather than Task&lt;bool&gt;. There is");
        Console.WriteLine("  nowhere in the interface to put an await.");
        Console.WriteLine();
        Console.WriteLine("  So the choice before C# 8 was: stream and block a thread per");
        Console.WriteLine("  consumer, or go async and buffer everything. IAsyncEnumerable exists");
        Console.WriteLine("  to remove that trade-off, and its whole contribution is the return");
        Console.WriteLine("  type of one method:");
        Console.WriteLine();
        Console.WriteLine("      IEnumerator&lt;T&gt;       bool      MoveNext()");
        Console.WriteLine("      IAsyncEnumerator&lt;T&gt;  ValueTask&lt;bool&gt; MoveNextAsync()");
        Console.WriteLine();
        Console.WriteLine("  ValueTask rather than Task, because MoveNextAsync is called once per");
        Console.WriteLine("  ITEM and usually completes synchronously — the page is already in");
        Console.WriteLine("  memory. 200,000 Tasks would be 200,000 allocations for 200 actual");
        Console.WriteLine("  awaits. That is precisely the case ValueTask was designed for.");

        Console.WriteLine();
        Console.WriteLine("=== the compiler generates a state machine, as with async ===");
        Console.WriteLine();
        var machine = typeof(Program).Assembly.GetTypes()
            .FirstOrDefault(t =&gt; t.Name.Contains("StreamRowsAsync"));
        if (machine is not null)
        {
            Console.WriteLine($"  generated type : {machine.Name}");
            Console.WriteLine($"  is a struct    : {machine.IsValueType}");
            foreach (var i in machine.GetInterfaces().Select(i =&gt; i.Name).OrderBy(n =&gt; n))
                Console.WriteLine($"  implements     : {i}");
        }
        Console.WriteLine();
        Console.WriteLine("  It is a CLASS, not a struct — unlike the async state machine in");
        Console.WriteLine("  t2-05. An async method's machine can live on the stack until it");
        Console.WriteLine("  suspends; an iterator must survive between calls to MoveNextAsync");
        Console.WriteLine("  from the very beginning, so there is nothing to gain by starting it");
        Console.WriteLine("  on the stack.");
        Console.WriteLine();
        Console.WriteLine("  Note that it implements BOTH IAsyncEnumerable and IAsyncEnumerator.");
        Console.WriteLine("  The first call to GetAsyncEnumerator returns the object itself; only");
        Console.WriteLine("  a SECOND concurrent enumeration allocates another. That is why");
        Console.WriteLine("  enumerating once — the normal case — costs one object.");
        Console.WriteLine();
        Console.WriteLine("  And note IValueTaskSource in that list. This is the pooling mechanism");
        Console.WriteLine("  t2-04 described: rather than allocating a Task per MoveNextAsync that");
        Console.WriteLine("  suspends, the state machine IS the backing source for its own");
        Console.WriteLine("  ValueTask and is reused across every item. That is how a stream of");
        Console.WriteLine("  200,000 items costs a fraction of a megabyte.");
        Console.WriteLine("  It is also why the ValueTask consumption rules from t2-04 are not");
        Console.WriteLine("  optional here: awaiting the ValueTask from MoveNextAsync twice, or");
        Console.WriteLine("  storing it, reads an object that has already been recycled.");

        Console.WriteLine();
        Console.WriteLine("=== await foreach is not foreach with an await ===");
        Console.WriteLine();
        Console.WriteLine("  await foreach (var row in source.WithCancellation(ct))");
        Console.WriteLine("      Handle(row);");
        Console.WriteLine();
        Console.WriteLine("  compiles to roughly:");
        Console.WriteLine();
        Console.WriteLine("      var e = source.GetAsyncEnumerator(ct);");
        Console.WriteLine("      try");
        Console.WriteLine("      {");
        Console.WriteLine("          while (await e.MoveNextAsync())");
        Console.WriteLine("              Handle(e.Current);");
        Console.WriteLine("      }");
        Console.WriteLine("      finally { await e.DisposeAsync(); }");
        Console.WriteLine();
        Console.WriteLine("  Two things to take from that. The disposal is asynchronous and is in");
        Console.WriteLine("  a finally, so breaking out of the loop still closes the connection");
        Console.WriteLine("  underneath. And Current is a plain property, not a Task: the await");
        Console.WriteLine("  is on ADVANCING, never on reading the value you have.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // --- the three shapes -----------------------------------------------------

    /// &lt;summary&gt;Buffers everything, then returns it. The default shape people write.&lt;/summary&gt;
    static async Task&lt;List&lt;byte[]&gt;&gt; GetAllRowsAsync(CancellationToken ct = default)
    {
        var all = new List&lt;byte[]&gt;(Rows);
        for (var page = 0; page &lt; Rows / 1000; page++)
        {
            await Task.Delay(2, ct).ConfigureAwait(false);
            for (var i = 0; i &lt; 1000; i++) all.Add(new byte[RowBytes]);
        }
        return all;
    }

    /// &lt;summary&gt;Streams, but must block to fetch each page.&lt;/summary&gt;
    static IEnumerable&lt;byte[]&gt; GetRowsSync()
    {
        for (var page = 0; page &lt; Rows / 1000; page++)
        {
            Thread.Sleep(2);                     // blocking: no await is possible here
            for (var i = 0; i &lt; 1000; i++) yield return new byte[RowBytes];
        }
    }

    /// &lt;summary&gt;Streams without blocking. One page in memory at a time.&lt;/summary&gt;
    static async IAsyncEnumerable&lt;byte[]&gt; StreamRowsAsync(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var page = 0; page &lt; Rows / 1000; page++)
        {
            await Task.Delay(2, ct).ConfigureAwait(false);
            for (var i = 0; i &lt; 1000; i++) yield return new byte[RowBytes];
        }
    }

    // --- consumers ------------------------------------------------------------
    static double ConsumeBuffered()
    {
        var first = -1.0;
        var sw = Stopwatch.StartNew();
        var all = GetAllRowsAsync().GetAwaiter().GetResult();
        foreach (var row in all)
        {
            if (first &lt; 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += row.Length;
        }
        return first;
    }

    static double ConsumeSyncStream()
    {
        var first = -1.0;
        var sw = Stopwatch.StartNew();
        foreach (var row in GetRowsSync())
        {
            if (first &lt; 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += row.Length;
        }
        return first;
    }

    static double ConsumeAsyncStream() =&gt; ConsumeAsyncStreamCore().GetAwaiter().GetResult();

    static async Task&lt;double&gt; ConsumeAsyncStreamCore()
    {
        var first = -1.0;
        var sw = Stopwatch.StartNew();
        await foreach (var row in StreamRowsAsync().ConfigureAwait(false))
        {
            if (first &lt; 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += row.Length;
        }
        return first;
    }

    // --- measurement ----------------------------------------------------------
    static void Measure(string label, Func&lt;double&gt; consume)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var before = GC.GetTotalMemory(forceFullCollection: true);

        var sw = Stopwatch.StartNew();
        var firstMs = consume();
        var totalMs = sw.Elapsed.TotalMilliseconds;

        // Peak is approximated by the live set at the end of the run, before
        // collection: for the buffered case the list is still rooted, for the
        // streaming cases nothing is.
        var peak = (GC.GetTotalMemory(forceFullCollection: false) - before) / 1024.0 / 1024.0;

        Console.WriteLine($"  {label,-33} {Math.Max(peak, 0),7:N1}   {firstMs,13:N0}   {totalMs,8:N0}");
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-cancellation.cs"><code>// 02-cancellation.cs — cancelling an async stream is not the same as cancelling
// an async method, because the token arrives in TWO places and only one attribute
// joins them up. This measures what happens when it is missing.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-cancellation.cs -c Release
#:property Nullable=enable
// CS8425 is suppressed ONLY because WithoutAttribute deliberately omits
// [EnumeratorCancellation] to demonstrate the bug. The compiler DOES warn about
// this by default, which is the good news reported in the output below.
#:property NoWarn=CS8425

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static int _produced;

    static void Main()
    {
        Console.WriteLine("=== the problem: a stream has two entry points ===");
        Console.WriteLine();
        Console.WriteLine("  An async METHOD is called once, so its token parameter is the only");
        Console.WriteLine("  way in. An async STREAM is different:");
        Console.WriteLine();
        Console.WriteLine("    1. the method call            StreamAsync(ct)");
        Console.WriteLine("    2. the enumeration            GetAsyncEnumerator(ct)");
        Console.WriteLine();
        Console.WriteLine("  Those can happen at different times, in different places, with");
        Console.WriteLine("  different tokens. Creating the stream does not start it — nothing");
        Console.WriteLine("  runs until the first MoveNextAsync — so the token that matters is");
        Console.WriteLine("  usually the one supplied at enumeration, which is what");
        Console.WriteLine("  WithCancellation sets.");
        Console.WriteLine();
        Console.WriteLine("  [EnumeratorCancellation] is what routes the SECOND one into your");
        Console.WriteLine("  method's parameter. Without it, WithCancellation is silently a no-op");
        Console.WriteLine("  on your producer.");

        Console.WriteLine();
        Console.WriteLine("=== measured: 100 items available, cancelled after 60 ms ===");
        Console.WriteLine();
        Console.WriteLine("  producer                              items produced   stopped after");

        Run("no attribute, WithCancellation", ct =&gt; WithoutAttribute(), useWith: true);
        Run("[EnumeratorCancellation], With", ct =&gt; WithAttribute(), useWith: true);
        Run("no attribute, token at CALL", ct =&gt; WithoutAttribute(ct), useWith: false);

        Console.WriteLine();
        Console.WriteLine("  Row 1 is the bug. WithCancellation supplied a token, the token was");
        Console.WriteLine("  cancelled, and the producer never saw it — because without the");
        Console.WriteLine("  attribute the compiler has no instruction to route it anywhere. The");
        Console.WriteLine("  producer's own ct parameter stayed default(CancellationToken), which");
        Console.WriteLine("  can never be cancelled.");
        Console.WriteLine();
        Console.WriteLine("  Row 3 shows the token passed at the CALL instead, which also works.");
        Console.WriteLine("  So why does the attribute exist? Because the caller frequently");
        Console.WriteLine("  cannot use row 3: they were handed an IAsyncEnumerable&lt;T&gt; by someone");
        Console.WriteLine("  else and the call already happened. A repository returns");
        Console.WriteLine("  IAsyncEnumerable&lt;Invoice&gt;; the controller enumerates it. Only");
        Console.WriteLine("  WithCancellation is available at that point.");
        Console.WriteLine();
        Console.WriteLine("  The good news, and it is easy to miss: THE COMPILER WARNS. Building");
        Console.WriteLine("  WithoutAttribute produces");
        Console.WriteLine();
        Console.WriteLine("      warning CS8425: Async-iterator has one or more parameters of type");
        Console.WriteLine("      CancellationToken but none of them is decorated with the");
        Console.WriteLine("      EnumeratorCancellation attribute, so the cancellation token");
        Console.WriteLine("      parameter from the generated GetAsyncEnumerator will be unconsumed");
        Console.WriteLine();
        Console.WriteLine("  This file suppresses CS8425 explicitly, because it needs the broken");
        Console.WriteLine("  version in order to measure it. In real code, do not suppress it —");
        Console.WriteLine("  treat it as an error. It is one of the few cases where the compiler");
        Console.WriteLine("  detects a purely semantic mistake about cancellation.");
        Console.WriteLine();
        Console.WriteLine("  The warning only fires when the iterator HAS a token parameter. An");
        Console.WriteLine("  async iterator with no token at all is silently uncancellable and");
        Console.WriteLine("  nothing complains, so the habit still has to be yours.");

        Console.WriteLine();
        Console.WriteLine("=== both tokens at once ===");
        Console.WriteLine();
        Console.WriteLine("  If a token is passed at the call AND at enumeration, the compiler");
        Console.WriteLine("  links them: your parameter receives a token cancelled when either");
        Console.WriteLine("  fires. You do not have to combine them yourself.");
        Console.WriteLine();
        Console.WriteLine($"  call token cancels first  : {BothTokens(cancelCall: true)}");
        Console.WriteLine($"  enum token cancels first  : {BothTokens(cancelCall: false)}");
        Console.WriteLine();
        Console.WriteLine("  Both stop the producer. This is the one place in .NET where linking");
        Console.WriteLine("  happens automatically, and it is worth knowing so you do not build a");
        Console.WriteLine("  second linked source on top of the one the compiler already made.");

        Console.WriteLine();
        Console.WriteLine("=== the finally block still runs ===");
        Console.WriteLine();
        Console.WriteLine("  A stream usually holds something that must be released — a database");
        Console.WriteLine("  reader, a file handle, a network connection. Cancellation must not");
        Console.WriteLine("  leak it.");
        Console.WriteLine();
        var released = CleanupOnCancel();
        Console.WriteLine($"  cancelled mid-stream, cleanup ran : {released}");
        Console.WriteLine();
        Console.WriteLine("  await foreach compiles its enumerator disposal into a finally, so");
        Console.WriteLine("  breaking, returning or throwing out of the loop all still call");
        Console.WriteLine("  DisposeAsync, which resumes your iterator at its finally block.");
        Console.WriteLine("  This is why 'await using' inside an async iterator is safe and is the");
        Console.WriteLine("  correct way to hold a connection open across a stream.");

        Console.WriteLine();
        Console.WriteLine("=== the caveat nobody mentions ===");
        Console.WriteLine();
        Console.WriteLine("  That cleanup only runs if the consumer DISPOSES the enumerator.");
        Console.WriteLine("  await foreach always does. Manual enumeration frequently does not:");
        Console.WriteLine();
        Console.WriteLine("      var e = source.GetAsyncEnumerator(ct);");
        Console.WriteLine("      while (await e.MoveNextAsync()) { ... break; }");
        Console.WriteLine("      // no DisposeAsync: the iterator is suspended forever, holding");
        Console.WriteLine("      // whatever it holds, until the GC gets to it - and an async");
        Console.WriteLine("      // iterator has no finaliser, so the finally may NEVER run.");
        Console.WriteLine();
        Console.WriteLine($"  manual enumeration, no dispose, cleanup ran : {NoDispose()}");
        Console.WriteLine();
        Console.WriteLine("  Use await foreach. If you must enumerate manually, wrap the");
        Console.WriteLine("  enumerator in 'await using'.");
        Console.WriteLine($"  (checksum {_produced})");
    }

    // --- producers ------------------------------------------------------------

    /// &lt;summary&gt;WRONG for a library: the enumeration token cannot reach this.&lt;/summary&gt;
    static async IAsyncEnumerable&lt;int&gt; WithoutAttribute(CancellationToken ct = default)
    {
        for (var i = 0; i &lt; 100; i++)
        {
            await Task.Delay(5, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    /// &lt;summary&gt;Right: the attribute routes GetAsyncEnumerator's token here.&lt;/summary&gt;
    static async IAsyncEnumerable&lt;int&gt; WithAttribute(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var i = 0; i &lt; 100; i++)
        {
            await Task.Delay(5, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    static async IAsyncEnumerable&lt;int&gt; Cleanup(
        StrongBox&lt;bool&gt; ran, [EnumeratorCancellation] CancellationToken ct = default)
    {
        try
        {
            for (var i = 0; i &lt; 100; i++)
            {
                await Task.Delay(5, ct).ConfigureAwait(false);
                yield return i;
            }
        }
        finally
        {
            ran.Value = true;                 // stands in for closing a connection
        }
    }

    // --- harness --------------------------------------------------------------

    static void Run(string label, Func&lt;CancellationToken, IAsyncEnumerable&lt;int&gt;&gt; make, bool useWith)
    {
        Volatile.Write(ref _produced, 0);
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(60);
        var sw = Stopwatch.StartNew();

        try { Consume(make, cts.Token, useWith).GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }

        Console.WriteLine($"  {label,-36} {Volatile.Read(ref _produced),14}   {sw.Elapsed.TotalMilliseconds,10:N0} ms");
    }

    static async Task Consume(Func&lt;CancellationToken, IAsyncEnumerable&lt;int&gt;&gt; make,
                              CancellationToken ct, bool useWith)
    {
        var source = make(useWith ? CancellationToken.None : ct);
        if (useWith)
        {
            await foreach (var _ in source.WithCancellation(ct).ConfigureAwait(false)) { }
        }
        else
        {
            await foreach (var _ in source.ConfigureAwait(false)) { }
        }
    }

    static string BothTokens(bool cancelCall)
    {
        using var call = new CancellationTokenSource();
        using var enumerate = new CancellationTokenSource();
        (cancelCall ? call : enumerate).CancelAfter(50);

        var sw = Stopwatch.StartNew();
        try
        {
            ConsumeBoth(call.Token, enumerate.Token).GetAwaiter().GetResult();
            return "ran to completion (unexpected)";
        }
        catch (OperationCanceledException)
        {
            return $"stopped after {sw.Elapsed.TotalMilliseconds:N0} ms";
        }
    }

    static async Task ConsumeBoth(CancellationToken call, CancellationToken enumerate)
    {
        await foreach (var _ in WithAttribute(call).WithCancellation(enumerate).ConfigureAwait(false)) { }
    }

    static bool CleanupOnCancel()
    {
        var ran = new StrongBox&lt;bool&gt;(false);
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(40);
        try { ConsumeCleanup(ran, cts.Token).GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }
        return ran.Value;
    }

    static async Task ConsumeCleanup(StrongBox&lt;bool&gt; ran, CancellationToken ct)
    {
        await foreach (var _ in Cleanup(ran).WithCancellation(ct).ConfigureAwait(false)) { }
    }

    static bool NoDispose()
    {
        var ran = new StrongBox&lt;bool&gt;(false);
        ManualCore(ran).GetAwaiter().GetResult();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        return ran.Value;
    }

    static async Task ManualCore(StrongBox&lt;bool&gt; ran)
    {
        var e = Cleanup(ran).GetAsyncEnumerator();
        for (var i = 0; i &lt; 3; i++) await e.MoveNextAsync().ConfigureAwait(false);
        // deliberately no DisposeAsync
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — Ledger's transaction export: the endpoint that worked for
// two years and then killed the pod when one customer got large enough.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Exports;

public sealed record Transaction(long Id, string Reference, decimal Amount, DateOnly Date);

/// &lt;summary&gt;Stands in for the transactions table, which returns rows in pages.&lt;/summary&gt;
public sealed class TransactionRepository
{
    private const int PageSize = 1_000;
    private readonly int _total;
    private int _rowsFetched;

    public TransactionRepository(int total) =&gt; _total = total;
    public int RowsFetched =&gt; Volatile.Read(ref _rowsFetched);
    public void Reset() =&gt; Volatile.Write(ref _rowsFetched, 0);

    /// &lt;summary&gt;THE SHIPPED VERSION. Materialises every row before returning.&lt;/summary&gt;
    public async Task&lt;List&lt;Transaction&gt;&gt; GetAllAsync(string account, CancellationToken ct = default)
    {
        var all = new List&lt;Transaction&gt;();
        for (var offset = 0; offset &lt; _total; offset += PageSize)
        {
            await Task.Delay(1, ct).ConfigureAwait(false);
            for (var i = 0; i &lt; PageSize &amp;&amp; offset + i &lt; _total; i++)
            {
                all.Add(NewRow(offset + i));
                Interlocked.Increment(ref _rowsFetched);
            }
        }
        return all;
    }

    /// &lt;summary&gt;THE FIX. One page in memory at a time, and cancellable throughout.&lt;/summary&gt;
    public async IAsyncEnumerable&lt;Transaction&gt; StreamAsync(
        string account, [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var offset = 0; offset &lt; _total; offset += PageSize)
        {
            await Task.Delay(1, ct).ConfigureAwait(false);
            for (var i = 0; i &lt; PageSize &amp;&amp; offset + i &lt; _total; i++)
            {
                Interlocked.Increment(ref _rowsFetched);
                yield return NewRow(offset + i);
            }
        }
    }

    private static Transaction NewRow(int i) =&gt;
        new(i, $"TX-{i:D9}", 10.00m + i % 500, new DateOnly(2026, 1, 1).AddDays(i % 365));
}

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger has a CSV export endpoint. It was written like this, which is");
        Console.WriteLine("  how almost everyone writes it:");
        Console.WriteLine();
        Console.WriteLine("      var rows = await _repo.GetAllAsync(account, ct);");
        Console.WriteLine("      return File(ToCsv(rows), \"text/csv\");");
        Console.WriteLine();
        Console.WriteLine("  It ran for two years. The largest customer had 40,000 transactions");
        Console.WriteLine("  and the endpoint used about 12 MB, which nobody noticed.");
        Console.WriteLine();
        Console.WriteLine("  Then a customer was onboarded with 2 million transactions, and three");
        Console.WriteLine("  of their users clicked Export at the same time.");
        Console.WriteLine();
        Console.WriteLine("  account size    buffered MB   streamed MB   buffered TTFB   streamed TTFB");

        foreach (var size in new[] { 40_000, 400_000, 2_000_000 })
            Compare(size);

        Console.WriteLine();
        Console.WriteLine("  A caveat on the streamed column before reading the rest: it measures");
        Console.WriteLine("  the heap after the run WITHOUT forcing a collection, so it includes");
        Console.WriteLine("  uncollected garbage rather than only retained data. That is why the");
        Console.WriteLine("  first streamed row reads higher than the later ones despite holding");
        Console.WriteLine("  less. The signal is that it does NOT grow with account size, not the");
        Console.WriteLine("  absolute figure.");
        Console.WriteLine();
        Console.WriteLine("  The buffered column is linear in row count, which is the whole problem:");
        Console.WriteLine("  it is not bounded by anything the service controls. The container");
        Console.WriteLine("  limit was 512 MB. Three concurrent exports of the new customer's data");
        Console.WriteLine("  needed more than that between them, so the pod was OOM-killed — which");
        Console.WriteLine("  dropped every OTHER request in flight on that instance too.");
        Console.WriteLine();
        Console.WriteLine("  TTFB is time to first byte. Buffering cannot emit anything until it");
        Console.WriteLine("  has everything, so the client waits the full query time before seeing");
        Console.WriteLine("  a single byte, and a gateway with a 30 s header timeout gives up");
        Console.WriteLine("  before the response starts.");

        Console.WriteLine();
        Console.WriteLine("=== the fix, and what it does not fix ===");
        Console.WriteLine();
        Console.WriteLine("      await foreach (var tx in _repo.StreamAsync(account, ct))");
        Console.WriteLine("          await writer.WriteLineAsync(ToCsvLine(tx));");
        Console.WriteLine();
        Console.WriteLine("  Memory becomes constant: one page, regardless of account size. TTFB");
        Console.WriteLine("  becomes the cost of one page rather than of the whole table.");
        Console.WriteLine();
        Console.WriteLine("  What it does NOT fix, and this matters:");
        Console.WriteLine();
        Console.WriteLine("  1. TOTAL TIME is unchanged. Streaming moves work around; it does not");
        Console.WriteLine("     remove it. A 2 million row export still takes as long as it takes.");
        Console.WriteLine();
        Console.WriteLine("  2. The DATABASE CONNECTION is now held for the whole response, rather");
        Console.WriteLine("     than for the query. If the client is slow, your connection is held");
        Console.WriteLine("     at the client's pace. A buffered read frees the connection early;");
        Console.WriteLine("     a streamed one couples it to network conditions you do not");
        Console.WriteLine("     control. On a pool of 100 connections this is a real limit, and it");
        Console.WriteLine("     is the genuine argument AGAINST streaming.");
        Console.WriteLine();
        Console.WriteLine("  3. You cannot change the status code once you have started writing.");
        Console.WriteLine("     A failure at row 1,900,000 arrives as a truncated 200 response.");
        Console.WriteLine("     Anything that can fail must be checked BEFORE the first yield.");

        Console.WriteLine();
        Console.WriteLine("=== the failure that only appears when streaming ===");
        Console.WriteLine();
        var repo = new TransactionRepository(50_000);
        Console.WriteLine($"  buffered, throws at row 30,000 : {BufferedFailure(repo)}");
        Console.WriteLine($"  streamed, throws at row 30,000 : {StreamedFailure(repo)}");
        Console.WriteLine();
        Console.WriteLine("  The buffered version fails before it writes anything, so the client");
        Console.WriteLine("  gets a clean 500. The streamed version has already sent 200 OK and");
        Console.WriteLine("  30,000 valid rows; all it can do is stop mid-file.");
        Console.WriteLine();
        Console.WriteLine("  The client sees a successful response containing a valid CSV that is");
        Console.WriteLine("  missing 40% of its data, with nothing to indicate truncation. This is");
        Console.WriteLine("  worse than an error, because it will be reconciled against and");
        Console.WriteLine("  believed.");
        Console.WriteLine();
        Console.WriteLine("  Mitigations, in order of how much they actually help:");
        Console.WriteLine("    - Write a trailer row (a checksum, or a row count) and have the");
        Console.WriteLine("      consumer verify it. This is the only one that fully works.");
        Console.WriteLine("    - Use chunked transfer with a documented terminator.");
        Console.WriteLine("    - Validate everything you can before the first yield.");
        Console.WriteLine("    - Log the truncation loudly: your metrics are the only place the");
        Console.WriteLine("      failure exists at all.");

        Console.WriteLine();
        Console.WriteLine("=== how the leak was found ===");
        Console.WriteLine();
        Console.WriteLine("  The pod restarted with no stack trace. Container OOM kills do not");
        Console.WriteLine("  produce one: the kernel stops the process and .NET never runs.");
        Console.WriteLine();
        Console.WriteLine("    kubectl describe pod ledger-api-7d4f    -&gt;  Reason: OOMKilled");
        Console.WriteLine("    dotnet-counters monitor --process-id &lt;pid&gt; System.Runtime");
        Console.WriteLine("      gc-heap-size          spikes to the limit, then the pod dies");
        Console.WriteLine("      gen-2-gc-count        rising sharply immediately before");
        Console.WriteLine("      alloc-rate            very high during a single request");
        Console.WriteLine();
        Console.WriteLine("    dotnet-gcdump collect --process-id &lt;pid&gt;   (during, not after)");
        Console.WriteLine("      -&gt; one List&lt;Transaction&gt; with millions of entries, rooted by a");
        Console.WriteLine("         request handler.");
        Console.WriteLine();
        Console.WriteLine("  The distinguishing signature: memory correlates with REQUEST SIZE");
        Console.WriteLine("  rather than with request COUNT. A leak grows with total requests and");
        Console.WriteLine("  never falls; this spikes on one request and returns to normal. That");
        Console.WriteLine("  difference tells you to look for buffering rather than for a leak,");
        Console.WriteLine("  and it is the fastest way to tell the two apart.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static void Compare(int size)
    {
        var repo = new TransactionRepository(size);

        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var sw = Stopwatch.StartNew();
        var rows = repo.GetAllAsync("ACC-1").GetAwaiter().GetResult();
        var bufferedTtfb = sw.Elapsed.TotalMilliseconds;
        var bufferedMb = (GC.GetTotalMemory(false) - before) / 1024.0 / 1024.0;
        _sink += rows.Count;
        rows = null!;

        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        before = GC.GetTotalMemory(true);
        var streamedTtfb = StreamFirst(repo);
        var streamedMb = (GC.GetTotalMemory(false) - before) / 1024.0 / 1024.0;

        Console.WriteLine($"  {size,12:N0}   {bufferedMb,11:N1}   {streamedMb,11:N1}   " +
                          $"{bufferedTtfb,13:N0}   {streamedTtfb,13:N0}");
    }

    static double StreamFirst(TransactionRepository repo) =&gt;
        StreamFirstCore(repo).GetAwaiter().GetResult();

    static async Task&lt;double&gt; StreamFirstCore(TransactionRepository repo)
    {
        var sw = Stopwatch.StartNew();
        var first = -1.0;
        await foreach (var tx in repo.StreamAsync("ACC-1").ConfigureAwait(false))
        {
            if (first &lt; 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += tx.Id;
        }
        return first;
    }

    static string BufferedFailure(TransactionRepository repo)
    {
        try
        {
            var rows = repo.GetAllAsync("ACC-1").GetAwaiter().GetResult();
            if (rows.Count &gt; 30_000) throw new InvalidOperationException("reader failed at row 30,000");
            return "completed";
        }
        catch (InvalidOperationException)
        {
            return "threw before writing anything -&gt; clean 500";
        }
    }

    static string StreamedFailure(TransactionRepository repo) =&gt;
        StreamedFailureCore(repo).GetAwaiter().GetResult();

    static async Task&lt;string&gt; StreamedFailureCore(TransactionRepository repo)
    {
        var written = 0;
        try
        {
            await foreach (var tx in repo.StreamAsync("ACC-1").ConfigureAwait(false))
            {
                if (written == 30_000) throw new InvalidOperationException("reader failed");
                written++;
                _sink += tx.Id;
            }
            return "completed";
        }
        catch (InvalidOperationException)
        {
            return $"already sent 200 OK and {written:N0} rows -&gt; truncated file";
        }
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs"><code>// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable
// Suppressed only because NoAttribute deliberately omits the attribute so that
// exercise 3 can measure the difference. See the exercise output.
#:property NoWarn=CS8425

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;
    static int _produced;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: when does the producer run? =====");
        Console.WriteLine();
        Volatile.Write(ref _produced, 0);
        var stream = Counting(5);
        Console.WriteLine($"  after calling the method     : {Volatile.Read(ref _produced)} produced");
        Consume(stream, take: 2).GetAwaiter().GetResult();
        Console.WriteLine($"  after consuming 2 items      : {Volatile.Read(ref _produced)} produced");
        Console.WriteLine();
        Console.WriteLine("  Calling an async iterator runs NONE of its body. It returns the state");
        Console.WriteLine("  machine and stops. This is the opposite of a normal async method,");
        Console.WriteLine("  which runs eagerly to its first await (t2-04: a Task is hot).");
        Console.WriteLine("  An IAsyncEnumerable is COLD: work happens only while you enumerate,");
        Console.WriteLine("  and stopping early means the rest never runs.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how many times does it run? =====");
        Console.WriteLine();
        Volatile.Write(ref _produced, 0);
        var twice = Counting(3);
        Consume(twice, take: 3).GetAwaiter().GetResult();
        Consume(twice, take: 3).GetAwaiter().GetResult();
        Console.WriteLine($"  enumerated twice, produced   : {Volatile.Read(ref _produced)} items");
        Console.WriteLine();
        Console.WriteLine("  Six, not three. Each enumeration runs the producer again, exactly");
        Console.WriteLine("  like IEnumerable&lt;T&gt; (t1-25). If the producer hits a database, you");
        Console.WriteLine("  have queried it twice — and unlike a List&lt;T&gt;, nothing about the type");
        Console.WriteLine("  warns you. Materialise with ToListAsync if you need it more than");
        Console.WriteLine("  once, and be deliberate about it.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which of these cancel? =====");
        Console.WriteLine();
        Console.WriteLine("  producer                              items   stopped after");
        Cancel("no attribute + WithCancellation", useAttribute: false);
        Cancel("[EnumeratorCancellation] + With", useAttribute: true);
        Console.WriteLine();
        Console.WriteLine("  Without the attribute the compiler has nowhere to route the token");
        Console.WriteLine("  supplied by WithCancellation, so the producer's parameter stays");
        Console.WriteLine("  default(CancellationToken) — which can never fire. The stream runs");
        Console.WriteLine("  to completion and WithCancellation is silently a no-op.");
        Console.WriteLine();
        Console.WriteLine("  The compiler DOES catch this: warning CS8425 fires on any async");
        Console.WriteLine("  iterator that takes a CancellationToken without the attribute. This");
        Console.WriteLine("  file suppresses it deliberately so the broken version can be");
        Console.WriteLine("  measured; in real code, treat CS8425 as an error.");
        Console.WriteLine();
        Console.WriteLine("  Its limit: it fires only when a token parameter EXISTS. An async");
        Console.WriteLine("  iterator with no token at all is uncancellable and warns about");
        Console.WriteLine("  nothing, so adding the parameter is still your job.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: does the cleanup run? =====");
        Console.WriteLine();
        Console.WriteLine($"  await foreach, break at 3    : {AwaitForeachBreak()}");
        Console.WriteLine($"  manual enumeration, no dispose: {ManualNoDispose()}");
        Console.WriteLine();
        Console.WriteLine("  await foreach compiles the DisposeAsync call into a finally, so");
        Console.WriteLine("  break, return and throw all resume the iterator at its own finally.");
        Console.WriteLine();
        Console.WriteLine("  Manual enumeration without disposing leaves the iterator suspended");
        Console.WriteLine("  forever. An async iterator has no finaliser, so the finally may never");
        Console.WriteLine("  run at all — whatever it holds (a connection, a file handle, a lock)");
        Console.WriteLine("  is held until the process ends.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: buffer or stream? =====");
        Console.WriteLine();
        Console.WriteLine("  200,000 rows, measured both ways:");
        Console.WriteLine();
        Console.WriteLine("  approach     retained MB   first item ms   total ms");
        BufferVsStream();
        Console.WriteLine();
        Console.WriteLine("  Stream when: the result is unbounded or caller-controlled in size,");
        Console.WriteLine("  the consumer can start work on the first item, or you are writing to");
        Console.WriteLine("  a response body or a file.");
        Console.WriteLine();
        Console.WriteLine("  Buffer when: the set is small and bounded, you need it more than");
        Console.WriteLine("  once, you need its count up front, you must be able to fail with a");
        Console.WriteLine("  clean status code, or you want the database connection released as");
        Console.WriteLine("  early as possible.");
        Console.WriteLine();
        Console.WriteLine("  That last one is the trade-off people miss. Streaming holds the");
        Console.WriteLine("  connection for the whole response, at the CLIENT's pace. On a");
        Console.WriteLine("  100-connection pool with slow clients, buffering can be the more");
        Console.WriteLine("  scalable choice, and 'always stream' is as wrong as 'always buffer'.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // --- producers ------------------------------------------------------------
    static async IAsyncEnumerable&lt;int&gt; Counting(int n)
    {
        for (var i = 0; i &lt; n; i++)
        {
            await Task.Delay(5).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    static async IAsyncEnumerable&lt;int&gt; NoAttribute(CancellationToken ct = default)
    {
        for (var i = 0; i &lt; 100; i++)
        {
            await Task.Delay(5, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    static async IAsyncEnumerable&lt;int&gt; WithAttribute(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var i = 0; i &lt; 100; i++)
        {
            await Task.Delay(5, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    static async IAsyncEnumerable&lt;int&gt; WithCleanup(StrongBox&lt;bool&gt; ran)
    {
        try
        {
            for (var i = 0; i &lt; 100; i++)
            {
                await Task.Delay(5).ConfigureAwait(false);
                yield return i;
            }
        }
        finally { ran.Value = true; }
    }

    // --- harness --------------------------------------------------------------
    static async Task Consume(IAsyncEnumerable&lt;int&gt; source, int take)
    {
        var seen = 0;
        await foreach (var v in source.ConfigureAwait(false))
        {
            _sink += v;
            if (++seen == take) break;
        }
    }

    static void Cancel(string label, bool useAttribute)
    {
        Volatile.Write(ref _produced, 0);
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(60);
        var sw = Stopwatch.StartNew();
        try { CancelCore(useAttribute, cts.Token).GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }
        Console.WriteLine($"  {label,-36} {Volatile.Read(ref _produced),6}   {sw.Elapsed.TotalMilliseconds,10:N0} ms");
    }

    static async Task CancelCore(bool useAttribute, CancellationToken ct)
    {
        var source = useAttribute ? WithAttribute() : NoAttribute();
        await foreach (var v in source.WithCancellation(ct).ConfigureAwait(false)) _sink += v;
    }

    static bool AwaitForeachBreak()
    {
        var ran = new StrongBox&lt;bool&gt;(false);
        BreakCore(ran).GetAwaiter().GetResult();
        return ran.Value;
    }

    static async Task BreakCore(StrongBox&lt;bool&gt; ran)
    {
        var seen = 0;
        await foreach (var v in WithCleanup(ran).ConfigureAwait(false))
        {
            _sink += v;
            if (++seen == 3) break;
        }
    }

    static bool ManualNoDispose()
    {
        var ran = new StrongBox&lt;bool&gt;(false);
        ManualCore(ran).GetAwaiter().GetResult();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        return ran.Value;
    }

    static async Task ManualCore(StrongBox&lt;bool&gt; ran)
    {
        var e = WithCleanup(ran).GetAsyncEnumerator();
        for (var i = 0; i &lt; 3; i++) await e.MoveNextAsync().ConfigureAwait(false);
        // deliberately no DisposeAsync
    }

    static void BufferVsStream()
    {
        const int Rows = 200_000;

        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var sw = Stopwatch.StartNew();
        var list = BufferAll(Rows).GetAwaiter().GetResult();
        var bufFirst = sw.Elapsed.TotalMilliseconds;
        var bufTotal = bufFirst;
        var bufMb = (GC.GetTotalMemory(true) - before) / 1024.0 / 1024.0;
        _sink += list.Count;
        Console.WriteLine($"  buffer     {bufMb,11:N1}   {bufFirst,13:N0}   {bufTotal,8:N0}");
        list = null!;

        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        before = GC.GetTotalMemory(true);
        sw = Stopwatch.StartNew();
        var streamFirst = StreamAll(Rows).GetAwaiter().GetResult();
        var streamTotal = sw.Elapsed.TotalMilliseconds;
        var streamMb = (GC.GetTotalMemory(true) - before) / 1024.0 / 1024.0;
        Console.WriteLine($"  stream     {Math.Max(streamMb, 0),11:N1}   {streamFirst,13:N0}   {streamTotal,8:N0}");
    }

    static async Task&lt;List&lt;byte[]&gt;&gt; BufferAll(int rows)
    {
        var all = new List&lt;byte[]&gt;(rows);
        for (var page = 0; page &lt; rows / 1000; page++)
        {
            await Task.Delay(1).ConfigureAwait(false);
            for (var i = 0; i &lt; 1000; i++) all.Add(new byte[512]);
        }
        return all;
    }

    static async Task&lt;double&gt; StreamAll(int rows)
    {
        var sw = Stopwatch.StartNew();
        var first = -1.0;
        await foreach (var row in StreamRows(rows).ConfigureAwait(false))
        {
            if (first &lt; 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += row.Length;
        }
        return first;
    }

    static async IAsyncEnumerable&lt;byte[]&gt; StreamRows(int rows)
    {
        for (var page = 0; page &lt; rows / 1000; page++)
        {
            await Task.Delay(1).ConfigureAwait(false);
            for (var i = 0; i &lt; 1000; i++) yield return new byte[512];
        }
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does <code>IAsyncEnumerable&lt;T&gt;</code> add that the other two shapes could not
      provide?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Streaming <em>and</em> non-blocking together. <code>Task&lt;List&lt;T&gt;&gt;</code> is
        non-blocking but buffers; <code>IEnumerable&lt;T&gt;</code> streams but must block, because
        <code>MoveNext()</code> returns <code>bool</code> and has nowhere to put an
        <code>await</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>MoveNextAsync</code> return <code>ValueTask&lt;bool&gt;</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It is called once per <strong>item</strong> and usually completes synchronously from a page
        already in memory. 200,000 items with 200 real waits would be 200,000 <code>Task</code>
        allocations. The generated type also implements <code>IValueTaskSource</code> and backs its
        own <code>ValueTask</code>, reused per item.</p>
      </div></details>
    </li>
    <li>
      <p>What does streaming buy, and what does it not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Buys: <strong>103.8 MB to 0.6 MB</strong>, and time to first item <strong>2,761 ms to
        17 ms</strong>. Does not buy throughput — total time was marginally worse. It changes the
        memory and latency profile, not the amount of work.</p>
      </div></details>
    </li>
    <li>
      <p>When does an async iterator's body start running?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>At the first <code>MoveNextAsync</code>, not at the call — verified: zero items produced
        after calling. It is <strong>cold</strong>, unlike a <code>Task</code>, which is hot.
        Enumerating twice runs the producer twice: six items from a three-item stream.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>[EnumeratorCancellation]</code> do, and what happens without it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It routes the token given to <code>GetAsyncEnumerator</code> — what
        <code>WithCancellation</code> supplies — into your parameter. Without it that parameter stays
        <code>default</code> and cancellation is silently ignored: <strong>100 items produced against
        5</strong>. <code>CS8425</code> warns, but only if the parameter exists.</p>
      </div></details>
    </li>
    <li>
      <p>Does the <code>finally</code> in an async iterator always run?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Only if the enumerator is disposed. <code>await foreach</code> always disposes, including on
        <code>break</code>. Manual enumeration without <code>DisposeAsync</code> leaves it suspended
        forever, and async iterators have <strong>no finaliser</strong> — verified: the cleanup never
        ran.</p>
      </div></details>
    </li>
    <li>
      <p>Name the two strongest arguments <em>against</em> streaming.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The database connection is held for the whole response at the <strong>client's</strong>
        pace rather than for the query; and you cannot change the status code after the first write,
        so a mid-stream failure is a truncated <code>200 OK</code> rather than a clean 500.</p>
      </div></details>
    </li>
    <li>
      <p>How do you distinguish buffering from a leak on a memory graph?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Buffering correlates with request <strong>size</strong>, spikes and returns to baseline. A
        leak correlates with request <strong>count</strong>, climbs steadily and never falls. In a
        gcdump: one huge collection rooted by a request handler, against many small objects rooted by
        a singleton.</p>
      </div></details>
    </li>
    <li>
      <p>Why does a container OOM kill leave no stack trace?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The kernel sends SIGKILL; the process stops immediately and no .NET code runs. The evidence
        is <code>Reason: OOMKilled</code> and exit code <strong>137</strong> (128 + 9). Looking for an
        exception wastes the first hour.</p>
      </div></details>
    </li>
    <li>
      <p>What single mitigation makes a streamed export safe to reconcile against?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <strong>trailer</strong> — a final row carrying a record count or checksum that the
        consumer verifies. It converts a silent truncation (measured: 30,000 of 50,000 rows under a
        <code>200 OK</code>) into a detectable failure. It is one line and it is the only mitigation
        that fully works.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
