CSPREP.module({
  id: "t2-08-cancellation",
  minutes: 55,
  updated: "2026-08-31",
  summary: "Cancellation in .NET is cooperative: Cancel() sets a flag and runs callbacks, and work that never checks the token runs to completion regardless. That single fact explains the module's central measurement, where 60 clients who had all given up still cost 3,000 rendered pages instead of 240 - and the feedback loop by which a brief slowdown becomes a sustained outage.",
  terms: ["CancellationToken", "CancellationTokenSource", "cooperative cancellation",
    "ThrowIfCancellationRequested", "OperationCanceledException", "TaskCanceledException",
    "linked token source", "CancelAfter", "RequestAborted", "CancellationToken.None",
    "CanBeCanceled", "CA2016", "token registration"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Your statement export renders fifty pages per account and takes about a second. On a bad
  afternoon the reporting database slows down and it starts taking eight seconds. The load balancer
  in front of you gives up at five, returns a gateway timeout, and the client retries.</p>

  <p>Here is what should happen next: the abandoned work stops, the capacity it was using is
  returned, and the retry is served promptly. Here is what actually happens: the abandoned work
  keeps going, all fifty pages of it, for a client that stopped listening three seconds ago. It
  competes for the same database with the retry. The retry also times out. Both are still running
  when the second retry arrives.</p>

  <p>Within two minutes the service is doing several times its normal work and completing none of
  it. The processor is busy, the database is busy, every metric says the system is working hard, and
  no user is being served. It does not recover on its own, because each timeout produces a retry and
  each retry produces more abandoned work. It recovers when someone sheds traffic or restarts
  things.</p>

  <p>The code that caused this looks completely correct:</p>

  <pre data-lang="csharp" data-net="10" data-title="ExportService.cs"><code>public async Task&lt;int&gt; ExportAsync(Statement statement, CancellationToken ct = default)
{
    var pages = new List&lt;string&gt;();
    for (var i = 0; i &lt; statement.PageCount; i++)
    {
        pages.Add(await _store.RenderPageAsync(i));
    }
    return pages.Count;
}</code></pre>

  <p>It accepts a <code>CancellationToken</code>. It has the right signature. It passes review. The
  defect is an <em>absence</em> — one argument, at one call site, not passed. The parameter is
  accepted at the top of the method and never used again, so the token has nothing to act on.</p>

  <p>This module is about the mechanism that makes that a no-op rather than an error, why nothing in
  your toolchain complains by default, and what the difference is worth: measured here at
  <strong>3,000 pages rendered against 240</strong>, for the same sixty clients, all of whom had
  already gone.</p>
</section>

<section id="plain-language">
  <h2>What cancellation actually is</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can run. Code executes on one, and nothing outside that thread can reach in
  and change what it is doing.</p>

  <p class="define"><span class="define__term">CancellationToken</span> A small readonly struct that
  can be asked one question — "has cancellation been requested?" — and can be given callbacks to run
  when it is. It has no power to stop anything. It is a signal, not a control.</p>

  <p class="define"><span class="define__term">CancellationTokenSource</span> The object that owns a
  token and is the only thing that can trip it. Whoever holds the source can cancel; whoever holds
  the token can only observe. That split is deliberate — you hand tokens to code you do not want
  cancelling things on your behalf.</p>

  <p class="define"><span class="define__term">Cooperative cancellation</span> The model .NET uses:
  cancellation is a request that running code must choose to honour. Code that never checks its token
  is not cancellable, no matter who calls <code>Cancel()</code> or how often.</p>

  <p><strong>An analogy, and its limits.</strong> Cancelling is knocking on the door of a room where
  someone is working and saying "we don't need that any more". If they are wearing headphones and
  never look up, they will finish the whole job and hand it to you. You cannot enter the room. There
  is no override. The only thing that makes the work stoppable is that the person inside agreed, in
  advance, to glance at the door periodically.</p>

  <p><strong>Where the analogy breaks:</strong> a person would eventually notice. Code notices
  exactly as often as it was written to, which is frequently never — and the failure is silent,
  because from the outside "finished the work you did not want" and "finished the work you did want"
  look identical.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>There is no API in .NET that forcibly stops a running operation.
    <code>Thread.Abort</code> existed in .NET Framework and was removed in .NET Core because it could
    not be made safe — it could interrupt a thread midway through updating shared state, leaving
    locks held and invariants broken. Cooperative cancellation is not a convenience; it is the only
    approach that can be correct.</p>
  </div>

  <p>Here is that fact, measured. The same work, cancelled immediately, once ignoring its token and
  once checking it:</p>

  <pre data-lang="console" data-title="01-cooperative.cs"><code>=== 1. cancelling something that does not check ===

  cancel() called at   :      0 ms
  work actually ended  :    505 ms
  token was cancelled  : True

=== 2. the same work, written to notice ===

  cancel() at          : ~50 ms
  work stopped at      :     62 ms
  threw                : OperationCanceledException</code></pre>

  <p>The token was cancelled half a second before the first version finished, and it finished
  anyway. <code>Cancel()</code> sets a boolean and runs any registered callbacks. That is the entire
  mechanism.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — the smallest program that shows cancellation being
// cooperative: the same work, once ignoring the token and once honouring it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static async Task Main()
    {
        await Run("ignores the token", IgnoresAsync);
        await Run("honours the token", HonoursAsync);
    }

    static async Task Run(string label, Func&lt;CancellationToken, Task&gt; work)
    {
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(50);                       // give up after 50 ms

        var sw = Stopwatch.StartNew();
        try
        {
            await work(cts.Token);
            Console.WriteLine($"{label,-20}: ran to completion in {sw.ElapsedMilliseconds} ms");
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine($"{label,-20}: stopped after {sw.ElapsedMilliseconds} ms");
        }
    }

    // The token is accepted and never used, so nothing can stop this.
    static async Task IgnoresAsync(CancellationToken ct)
    {
        for (var i = 0; i &lt; 10; i++)
            await Task.Delay(30).ConfigureAwait(false);
    }

    // The token reaches the awaited call, so cancellation takes effect.
    static async Task HonoursAsync(CancellationToken ct)
    {
        for (var i = 0; i &lt; 10; i++)
            await Task.Delay(30, ct).ConfigureAwait(false);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>ignores the token   : ran to completion in 346 ms
honours the token   : stopped after 68 ms</code></pre>

  <p>The two methods differ by four characters — <code>, ct</code> — and that is the whole module in
  one diff. Both accept a token. Both have a signature that satisfies every convention and every
  code review. One is cancellable and one is not.</p>

  <p><strong>Note what the first method does <em>not</em> do:</strong> it does not throw, warn, or
  behave strangely. It returns successfully, having done work nobody wanted, and reports success. If
  this were an endpoint, your logs would show a completed request.</p>

  <p><strong>And note where the token had to go.</strong> Not into a check at the top of the method —
  that would catch only a client who had already given up before you started. It had to go into the
  call that does the waiting, inside the loop, so that each iteration is a place the work can stop.
  Cancellation granularity is decided by where you pass the token, and the useful granularity is
  usually "every iteration", not "once at the start".</p>
</section>

<section id="checking">
  <h2>The two ways to check, and what the exception means</h2>

  <p class="define"><span class="define__term">ThrowIfCancellationRequested</span> A method on the
  token that throws <code>OperationCanceledException</code> if cancellation has been requested, and
  does nothing otherwise. This is the default way to honour a token, because throwing propagates
  automatically and callers already understand the exception.</p>

  <p class="define"><span class="define__term">OperationCanceledException</span> The exception that
  signals "this stopped because it was asked to" rather than "this failed".
  <code>TaskCanceledException</code> derives from it, so <strong>catch the base type</strong> — code
  that catches only <code>TaskCanceledException</code> misses direct token throws, which is a real
  and common bug.</p>

  <pre data-lang="console" data-title="01-cooperative.cs"><code>  token.ThrowIfCancellationRequested()   OperationCanceledException  (is an OperationCanceledException)
  await Task.Delay(1000, token)          TaskCanceledException  (is an OperationCanceledException)
  Task.FromCanceled(token)               TaskCanceledException  (is an OperationCanceledException)</code></pre>

  <p>The alternative is to test <code>token.IsCancellationRequested</code> and return normally. That
  is right when you must clean up or return a partial result — and it carries a trap:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: silently returns an incomplete answer"><code>// WRONG. The caller receives 0 of 1000 items and no indication that this is
// a partial result. "Finished" and "gave up" are now indistinguishable.
static int PartialResult(CancellationToken ct)
{
    var done = 0;
    for (var i = 0; i &lt; 1000; i++)
    {
        if (ct.IsCancellationRequested) break;
        done++;
    }
    return done;
}</code></pre>

  <p>If you return normally after a cancellation, the return type must say so — a status enum, a
  tuple carrying "was cancelled", or a result object. Otherwise the caller cannot tell the
  difference, and a partial answer flows on as if it were complete. Throwing is the default for
  exactly this reason: it is impossible to ignore by accident.</p>

  <h3>Cancellation is not failure</h3>

  <pre data-lang="console" data-title="01-cooperative.cs"><code>  task status          : Canceled
  IsCanceled           : True
  IsFaulted            : False</code></pre>

  <p><code>Canceled</code> is its own terminal state, distinct from <code>Faulted</code>. This is an
  operational point, not a trivia one: a cancelled request is not an error, and logging it as one
  turns every user who closed a browser tab into an entry in your error budget. Services that alert
  on exception rate and do not exclude <code>OperationCanceledException</code> page someone every
  time a mobile client goes through a tunnel.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>A widely repeated claim is that throwing a bare <code>OperationCanceledException</code>, rather
    than one carrying the token, makes the task <em>fault</em> instead of cancelling. On .NET 10 that
    is not what happens:</p>
    <pre data-lang="console" data-title="01-cooperative.cs"><code>  case                              status      oce.Token == ct
  Task.Run body, OCE(ct)            Canceled    True
  Task.Run body, bare OCE           Canceled    False
  async method, OCE(ct)             Canceled    True
  async method, bare OCE            Canceled    False</code></pre>
    <p>The status is <code>Canceled</code> in all four. What differs is the token the exception
    carries — and that turns out to matter more, because it is how a catch site answers the question
    "was this <em>my caller</em> giving up, or something else?" Use
    <code>ThrowIfCancellationRequested()</code>, which carries the token for free.</p>
  </div>
</section>

<section id="linking">
  <h2>Linking, timeouts, and telling them apart</h2>

  <p>Almost every real call has two reasons to stop: the caller may give up, and you have a deadline
  of your own. You need one token that fires on either.</p>

  <p class="define"><span class="define__term">Linked token source</span> A
  <code>CancellationTokenSource</code> created from one or more existing tokens with
  <code>CreateLinkedTokenSource</code>. Its token is cancelled when any of its sources is. It is how
  you combine a caller's cancellation with your own timeout without the two knowing about each
  other.</p>

  <p class="define"><span class="define__term">CancelAfter</span> A method that starts a timer on a
  source and cancels it when the time elapses. <code>new CancellationTokenSource(TimeSpan)</code>
  does the same at construction. This is how a deadline is expressed.</p>

  <pre data-lang="csharp" data-net="10" data-title="The standard shape"><code>static async Task DoWorkAsync(int workMs, TimeSpan timeout, CancellationToken ct)
{
    using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
    linked.CancelAfter(timeout);
    await Task.Delay(workMs, linked.Token).ConfigureAwait(false);
}</code></pre>

  <pre data-lang="console" data-title="02-linking-and-timeouts.cs"><code>  scenario                      outcome                    ms
  caller cancels at 60 ms       cancelled by caller         73
  timeout fires at 100 ms       timed out                  114
  work finishes first           completed                   69</code></pre>

  <p><strong>All three outcomes are distinguished, and that is the point.</strong> A caller
  cancellation and a timeout need opposite handling. The caller going away is not an error, must not
  be retried, and should not be logged as a failure — there is nobody to serve. A timeout <em>is</em>
  a failure of your dependency, belongs in your error budget, and may well be worth retrying.</p>

  <p>Telling them apart requires care, because the linked token is a <em>third</em> token and it is
  cancelled in both cases. Comparing the exception against it proves nothing. You have to ask the
  original source:</p>

  <pre data-lang="csharp" data-net="10" data-title="Distinguishing the two"><code>try
{
    await DoWorkAsync(statement, timeout, ct);
}
catch (OperationCanceledException) when (ct.IsCancellationRequested)
{
    // The caller gave up. Not an error. Do not retry, do not alert.
    return;
}
catch (OperationCanceledException)
{
    // Our own deadline fired. This is a dependency failure.
    _logger.LogWarning("statement export timed out after {Timeout}", timeout);
    throw new TimeoutException("statement export timed out");
}</code></pre>

  <p><strong>Check the caller first.</strong> If both fired, the caller having gone is the more
  useful explanation and the one that should not page anyone.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>A linked source <em>registers a callback</em> on every token it links, and that registration
    lives as long as the <strong>parent</strong> token, not as long as the child. Against a
    process-lifetime token — an application-stopping token, a connection-scoped token — an undisposed
    linked source is an unbounded leak:</p>
    <pre data-lang="console" data-title="02-linking-and-timeouts.cs — 10,000 linked sources"><code>  variant                        KB retained by the parent
  not disposed                        1,406
  disposed                                0</code></pre>
    <p>Nothing in that measurement holds a reference to the linked sources; they go out of scope
    immediately, exactly as they would in a request handler. They survive collection because the
    parent token is holding them. <code>using var linked = ...</code> is not optional.</p>
    <p>The same applies to <code>token.Register(...)</code>, which returns a registration that must be
    disposed — and it is a return value people routinely discard.</p>
  </div>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><code>CancellationToken.None</code> and <code>default(CancellationToken)</code> are
    <strong>equal</strong> — verified, not asserted. The difference is one of intent:
    <code>None</code> at a call site says "this genuinely cannot be cancelled and I decided that",
    whereas a defaulted parameter usually means nobody considered it. Reviewers can act on the
    first.</p>
    <p><code>CanBeCanceled</code> is <code>false</code> for both, which lets a library skip
    registering callbacks entirely for a token that can never fire.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>Ledger's statement export renders fifty pages per account. The endpoint takes a token, as every
  ASP.NET Core action can:</p>

  <pre data-lang="csharp" data-net="10" data-title="The endpoint, which is correct"><code>public async Task&lt;IActionResult&gt; Export(string id, CancellationToken ct)
    =&gt; Ok(await _export.ExportAsync(await LoadStatementAsync(id, ct), ct));</code></pre>

  <p class="define"><span class="define__term">RequestAborted</span> The token ASP.NET Core supplies
  to an action's <code>CancellationToken</code> parameter, taken from
  <code>HttpContext.RequestAborted</code>. It fires when the client disconnects — closes the tab,
  loses signal, or is cut off by a gateway timeout upstream of you. It arrives for free; the only
  question is whether your code does anything with it.</p>

  <p>The endpoint passed it correctly. One layer down, a loop did not:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the shipped version"><code>/// &lt;summary&gt;
/// THE BUG. The endpoint accepts a token and passes it to the FIRST call, then
/// drops it. Everything after that runs to completion regardless.
/// &lt;/summary&gt;
public sealed class ExportServiceV1
{
    private readonly StatementStore _store;
    public ExportServiceV1(StatementStore store) =&gt; _store = store;

    public async Task&lt;int&gt; ExportAsync(Statement statement, CancellationToken ct = default)
    {
        var pages = new List&lt;string&gt;();
        for (var i = 0; i &lt; statement.PageCount; i++)
        {
            // The token is not passed. Nothing here can ever stop early.
            pages.Add(await _store.RenderPageAsync(i).ConfigureAwait(false));
        }
        return pages.Count;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right: the token reaches the work"><code>/// &lt;summary&gt;THE FIX. The token reaches every awaited call and every loop iteration.&lt;/summary&gt;
public sealed class ExportServiceV2
{
    private readonly StatementStore _store;
    public ExportServiceV2(StatementStore store) =&gt; _store = store;

    public async Task&lt;int&gt; ExportAsync(Statement statement, CancellationToken ct = default)
    {
        var pages = new List&lt;string&gt;();
        for (var i = 0; i &lt; statement.PageCount; i++)
        {
            ct.ThrowIfCancellationRequested();
            pages.Add(await _store.RenderPageAsync(i, ct).ConfigureAwait(false));
        }
        return pages.Count;
    }
}</code></pre>

  <p>Sixty clients request an export and give up after 120 ms:</p>

  <pre data-lang="console" data-title="03-production.cs"><code>  version                     pages rendered   of possible   total ms
  token dropped in the loop   3,000 of 3,000          100%      1,544
  token threaded through        240 of 3,000            8%        132</code></pre>

  <p>Every client had gone in both runs, so every page rendered in either column was wasted work. The
  column says how much was done before stopping: <strong>everything, against eight per cent.</strong>
  That gap is capacity you paid for and spent producing output with no recipient — and it is spent at
  exactly the moment you can least afford it, because clients give up when you are already slow.</p>

  <h3>The feedback loop</h3>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The waste is not the real cost. The real cost is that it is <em>self-reinforcing</em>:</p>
    <ol>
      <li>Something makes the service slow. Latency rises.</li>
      <li>Clients hit their timeouts and disconnect.</li>
      <li>Their work keeps running, because the token went nowhere.</li>
      <li>That work competes with the retries those same clients now send.</li>
      <li>Latency rises further. Return to step 2.</li>
    </ol>
    <p>This is why an incident that should have been a ninety-second slowdown becomes a sustained
    outage that does not recover until traffic is shed. A correctly threaded token breaks the loop at
    step 3: abandoned work stops, and capacity is returned in time to serve the retries. It is one of
    the cheapest pieces of resilience available, and it is free with the framework — you only have to
    not drop the argument.</p>
  </div>

  <h3>Why it survived review</h3>

  <p>Nothing about the broken version looks broken. It accepts a token, it has the conventional
  signature, and it satisfies any rule that merely checks for the presence of a token parameter. The
  defect is an absence at one call site out of several.</p>

  <p>No test fails either, unless somebody wrote one that cancels mid-flight and asserts that the
  work stopped — and almost nobody does, because a cancellation test looks like a test of the
  framework rather than of your own code.</p>

  <pre data-lang="csharp" data-net="10" data-title="The test that catches it"><code>[Fact]
public async Task ExportAsync_StopsEarly_WhenTheCallerCancels()
{
    var store = new StatementStore();
    var service = new ExportService(store);
    var statement = new Statement("ACC-1", PageCount: 50);

    using var cts = new CancellationTokenSource();
    cts.CancelAfter(TimeSpan.FromMilliseconds(50));

    await Assert.ThrowsAsync&lt;OperationCanceledException&gt;(
        () =&gt; service.ExportAsync(statement, cts.Token));

    // THIS is the assertion that matters. Without it the test passes on the
    // broken version too, because the FIRST call does receive the token.
    Assert.True(store.PagesRendered &lt; statement.PageCount,
        $"rendered {store.PagesRendered} of {statement.PageCount} after cancelling");
}</code></pre>

  <p>The second assertion is the important one, and it is the one that gets left out. Without it the
  test passes against the broken implementation, because the exception is thrown by whichever call
  <em>does</em> receive the token — usually the first one.</p>

  <h3>The second bug in the same service</h3>

  <p>A background reconciliation loop linked each job's token to the host's application-stopping
  token and never disposed the link:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a registration per job, forever"><code>// WRONG. _appStopping lives for the life of the process, so every job leaves a
// registration on it permanently. No 'using'.
var linked = CancellationTokenSource.CreateLinkedTokenSource(_appStopping, jobCts.Token);</code></pre>

  <pre data-lang="console" data-title="03-production.cs — 10,000 jobs"><code>  10,000 jobs, undisposed :    3,437 KB retained
  10,000 jobs, disposed   :        0 KB retained</code></pre>

  <p>The signature of this leak is distinctive and worth memorising: <strong>memory grows with total
  work done since start</strong> rather than with concurrency, it never falls, and it is unaffected
  by load dropping to zero. A restart "fixes" it, which is why it can survive for months in a service
  that deploys weekly.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Accepting a token and not forwarding it</h3>

  <p>The module's central bug. Measured at 3,000 pages against 240. Caught by <strong>CA2016</strong>,
  "Forward the <code>CancellationToken</code> parameter to methods that take one", which is the
  single highest-value analyser rule here.</p>

  <h3>2. Swallowing the cancellation</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: cancellation becomes success"><code>// WRONG. The caller cannot tell a cancelled export from a completed one, and
// an empty result flows onward as though it were real data.
try
{
    return await _export.ExportAsync(statement, ct);
}
catch (OperationCanceledException)
{
    return Array.Empty&lt;string&gt;();
}

// Right: let it propagate. The framework already knows what to do with it.
return await _export.ExportAsync(statement, ct);</code></pre>

  <h3>3. Logging cancellation as an error</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: every closed browser tab pages someone"><code>// WRONG. A disconnected client is not an error, and this will dominate your
// error rate the first time a mobile network has a bad hour.
catch (Exception ex)
{
    _logger.LogError(ex, "export failed");
    throw;
}

// Right: separate the two, and check the caller's token first.
catch (OperationCanceledException) when (ct.IsCancellationRequested)
{
    _logger.LogInformation("export abandoned by the caller");
    throw;
}
catch (Exception ex)
{
    _logger.LogError(ex, "export failed");
    throw;
}</code></pre>

  <h3>4. Not disposing a linked source or a registration</h3>

  <p>Measured at 1,406 KB per 10,000 links against a long-lived parent, with nothing else holding a
  reference. <code>using var</code> on every <code>CreateLinkedTokenSource</code>, and dispose the
  <code>CancellationTokenRegistration</code> that <code>Register</code> returns.</p>

  <h3>5. Cancelling a source you then dispose too early</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a race on disposal"><code>// WRONG. Disposing a source while a registered callback is still running, or
// while a linked child still references it, throws ObjectDisposedException from
// a place that is very hard to attribute.
using var cts = new CancellationTokenSource();
_ = Task.Run(() =&gt; LongRunningAsync(cts.Token));   // not awaited
// cts disposed here, while the work is still using its token

// Right: the source must outlive every user of its token.
using var cts = new CancellationTokenSource();
await LongRunningAsync(cts.Token);</code></pre>

  <h3>6. A timeout that is not linked to the caller</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the caller's cancellation is discarded"><code>// WRONG. The caller's token is accepted and then replaced. A client that
// disconnects is now ignored entirely; only our own deadline can stop this.
public async Task&lt;int&gt; ExportAsync(Statement s, CancellationToken ct)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
    return await RenderAsync(s, timeout.Token);
}

// Right: link them, so either can stop the work.
public async Task&lt;int&gt; ExportAsync(Statement s, CancellationToken ct)
{
    using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
    linked.CancelAfter(TimeSpan.FromSeconds(30));
    return await RenderAsync(s, linked.Token);
}</code></pre>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> under load the service does far more work than the request rate
    justifies, and does not recover when traffic falls.</p>
    <p><strong>Why:</strong> abandoned work is still running. Requests that timed out or disconnected
    are consuming capacity that the retries then cannot get.</p>
    <p><strong>Tool:</strong> compare requests started against requests completed, and both against
    the work your dependencies see. In ASP.NET Core the built-in counters give you the first half:</p>
    <pre data-lang="console" data-title="Requests in flight versus completed"><code>dotnet-counters monitor --process-id 4812 \
    Microsoft.AspNetCore.Hosting System.Runtime

    current-requests        rising and not falling
    requests-per-second     flat or falling
    total-requests          diverging from your dependency call count</code></pre>
    <p><strong>Reading it:</strong> if <code>current-requests</code> keeps climbing while the incoming
    rate is flat, requests are not finishing — and if your database sees more queries than you have
    live clients, the surplus is abandoned work.</p>
    <p><strong>Fix:</strong> thread the token. Then verify with the test that asserts on work done,
    not merely on the exception.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> your error rate is dominated by exceptions that are not faults.</p>
    <p><strong>Tool:</strong> group your exception telemetry by type before you group it by endpoint.
    A large <code>TaskCanceledException</code> or <code>OperationCanceledException</code> population
    that correlates with client-side network conditions rather than with your deployments is
    disconnections, not failures.</p>
    <p><strong>Fix:</strong> classify at the catch site — <code>when
    (ct.IsCancellationRequested)</code> distinguishes the caller giving up from your own timeout —
    and exclude the first from your error budget. Keep counting them, though: a sudden rise in caller
    cancellations is a real signal that you have become slow.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> memory grows steadily over days, tracks total requests served rather
    than concurrency, never falls, and is unaffected when load drops to zero.</p>
    <p><strong>Why:</strong> registrations accumulating on a long-lived token — an undisposed linked
    source, or a discarded <code>Register</code> result.</p>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="Finding retained registrations"><code>dotnet-gcdump collect --process-id 4812
# or, in a dump:
dotnet-dump analyze core_20260831.dmp
&gt; dumpheap -stat -type CancellationToken
&gt; gcroot &lt;address of a CancellationTokenSource&gt;</code></pre>
    <p><strong>Reading it:</strong> a large and growing count of
    <code>CancellationTokenSource</code> or <code>CancellationCallbackInfo</code> objects, with
    <code>gcroot</code> showing them held by a single long-lived source, is conclusive. The root will
    be the application-stopping token or a connection-scoped one.</p>
    <p><strong>Fix:</strong> <code>using</code> on every linked source, and dispose every
    registration.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you want this class of bug prevented rather than found.</p>
    <pre data-lang="console" data-title="Enforcing token flow"><code># In .editorconfig — CA2016 is the one that matters most here.
dotnet_diagnostic.CA2016.severity = error   # forward the CancellationToken parameter
dotnet_diagnostic.CA1068.severity = error   # CancellationToken parameters must come last</code></pre>
    <p><strong>Reading it:</strong> CA2016 fires exactly on the Ledger bug — a method that has a token
    in scope calling a method that accepts one, without passing it. It is off or merely a suggestion
    in many project templates, which is why this defect is so widespread.</p>
    <p><strong>Caveat worth knowing:</strong> CA2016 cannot see cases where the callee takes no token
    at all. If a layer of your own code does not accept one, the analyser has nothing to complain
    about and the chain is broken there. Adding the parameter is the fix, and it propagates.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Cancellation is the cheapest load-shedding you will ever deploy.</strong> Sixty clients
    who had all disconnected cost 3,000 rendered pages and 1,544 ms with the token dropped, against
    240 pages and 132 ms with it threaded — a twelvefold reduction in work, from passing an argument.
    No new infrastructure, no configuration, no circuit breaker. In a service where the expensive
    resource is a shared database, that work was not merely wasted locally: it was contention
    inflicted on every other request in the system.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>It decides whether an incident is self-limiting or self-sustaining.</strong> With
    tokens threaded, a slow dependency produces a burst of timeouts and then stabilises, because
    abandoned work stops and capacity returns. Without them, every timeout leaves its work running
    and adds a retry, so load rises as a direct consequence of being slow. The difference between a
    graph that spikes and recovers and one that goes to the ceiling and stays there is frequently
    nothing more than whether a token reached a loop.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The leak version is a slow, invisible outage with a monthly period.</strong> 10,000
    undisposed linked sources retained 3,437 KB. A service handling a modest 50 requests per second
    creates 4.3 million of them a day; at the measured rate that is roughly 1.4 GB a day of pure
    registration, growing until the container is killed. Because a restart clears it and most
    services deploy weekly, this can persist for a very long time as "we restart it
    occasionally and it is fine", which is a sentence that should always be investigated.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Calling <code>Cancel()</code> stops the work."</strong> It sets a flag and runs
    callbacks. Measured: work cancelled at 0 ms finished at 505 ms, because it never checked. Nothing
    in .NET can forcibly stop running code — <code>Thread.Abort</code> was removed precisely because
    it could not do so safely.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"My method takes a <code>CancellationToken</code>, so it is cancellable."</strong>
    Taking one and forwarding one are different things. The Ledger method accepted a token, passed
    review, and rendered 100% of its pages after every client had gone.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Catch <code>TaskCanceledException</code>."</strong> Catch
    <code>OperationCanceledException</code>, the base type.
    <code>ThrowIfCancellationRequested</code> throws the base type directly, so a handler for the
    derived type alone will miss it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A cancelled task is a failed task."</strong> <code>Canceled</code> is a separate
    terminal state — verified: <code>IsCanceled</code> true, <code>IsFaulted</code> false. Treating
    the two identically in telemetry means every abandoned browser tab counts against your
    availability.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>CancellationToken.None</code> and <code>default</code> differ."</strong> They
    are equal — verified. The difference is intent expressed to a reader, which is worth something,
    but no code behaves differently.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Linked sources are lightweight, so disposing them is optional."</strong> Each one
    registers a callback on its parent that lives as long as the <em>parent</em>. Against a
    process-lifetime token that is an unbounded leak: 1,406 KB per 10,000, with nothing else holding
    a reference.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Checking the token once at the top of the method is enough."</strong> That catches
    only a caller who gave up before you started. Cancellation granularity is decided by where the
    token goes — the useful place is inside the loop, on every awaited call.</p>
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
    <p>This work is cancelled immediately after it starts. When does it stop?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>using var cts = new CancellationTokenSource();
var t = Task.Run(() =&gt;
{
    var e = Stopwatch.StartNew();
    while (e.ElapsedMilliseconds &lt; 300) _sink++;
});
cts.Cancel();
await t;</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  cancelled at ~0 ms, work ended at 303 ms</code></pre>
        <p><strong>It does not stop. It runs for its full 300 ms.</strong> The loop never looks at the
        token, so nothing about it can be cancelled.</p>
        <p><code>Cancel()</code> sets a boolean and runs registered callbacks. That is the whole
        mechanism, and it is the definition of <em>cooperative</em>: cancellation is a request that
        running code must choose to honour. There is no API in .NET that forcibly stops a running
        operation — <code>Thread.Abort</code> was removed in .NET Core because interrupting a thread
        at an arbitrary instruction can leave locks held and shared state half-updated.</p>
        <p>Note that the token was not even passed to <code>Task.Run</code> here. Passing it would
        have made the task cancellable <em>before it started</em>, but once the body is running it
        would still make no difference — the body has to check.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Which exception type does each of these throw, what should you catch, and is a cancelled task
    a failed task?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>token.ThrowIfCancellationRequested();
await Task.Delay(1000, token);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  ThrowIfCancellationRequested -&gt; OperationCanceledException
  Task.Delay(1000, token)      -&gt; TaskCanceledException

  task status Canceled, IsFaulted=False</code></pre>
        <p><strong>Catch <code>OperationCanceledException</code></strong> — the base type.
        <code>TaskCanceledException</code> derives from it, so the base catches both, whereas catching
        only the derived type misses every direct <code>ThrowIfCancellationRequested</code>.</p>
        <p><strong>A cancelled task is not a failed task.</strong> <code>Canceled</code> is its own
        terminal state: <code>IsCanceled</code> true, <code>IsFaulted</code> false. This is
        operationally significant rather than academic — if your telemetry treats every exception as
        an error, every user who closes a tab mid-request lands in your error budget, and the first
        bad hour on a mobile network will look like an outage.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>An operation links the caller's token with its own timeout. After it throws, how do you tell
    which one fired — and why does testing the linked token not work?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  scenario                      outcome
  caller cancels at 50 ms       cancelled by caller
  timeout at 80 ms              timed out</code></pre>
        <p><strong>Testing the linked token proves nothing, because it is cancelled in both
        cases</strong> — that is its entire purpose. You have to ask the original source:</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>catch (OperationCanceledException) when (caller.IsCancellationRequested)
{
    // The caller gave up: not an error, do not retry, do not alert.
}
catch (OperationCanceledException)
{
    // Our own timeout fired: a dependency failure. Log it. Possibly retry.
}</code></pre>
        <p><strong>Order matters.</strong> Check the caller first. If both fired — which happens when
        a slow operation reaches its deadline at about the moment the client gives up — the caller
        having gone is the more useful explanation and the one that should not page anyone.</p>
        <p>The distinction is worth the effort because the two demand opposite responses. Retrying a
        caller cancellation is pure waste: there is nobody left to receive the result. Not retrying a
        timeout may drop work that mattered.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This method accepts a token and is still uncancellable. Find the defect, then say what would
    have caught it.</p>
    <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Exercise 4"><code>static async Task ExportAsync(int pages, CancellationToken ct)
{
    for (var i = 0; i &lt; pages; i++)
    {
        await Task.Delay(20);
        Interlocked.Increment(ref _pages);
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  token dropped   :  30 of 30 pages rendered after cancellation
  token threaded  :   2 of 30 pages rendered after cancellation</code></pre>
        <p><strong>The parameter is accepted and never used.</strong> <code>Task.Delay(20)</code> has
        an overload taking a token; this call does not use it. Every one of the thirty pages renders
        after the caller has gone.</p>
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>static async Task ExportAsync(int pages, CancellationToken ct)
{
    for (var i = 0; i &lt; pages; i++)
    {
        ct.ThrowIfCancellationRequested();
        await Task.Delay(20, ct).ConfigureAwait(false);
        Interlocked.Increment(ref _pages);
    }
}</code></pre>
        <p>Both lines earn their place. Passing the token to <code>Task.Delay</code> makes the wait
        itself cancellable; <code>ThrowIfCancellationRequested</code> at the top of the loop covers
        the case where the awaited call completes synchronously and never observes the token at
        all.</p>
        <p><strong>What catches it: CA2016</strong>, "Forward the <code>CancellationToken</code>
        parameter to methods that take one". It is the highest-value analyser rule in this module and
        it is not an error by default in most templates. Set
        <code>dotnet_diagnostic.CA2016.severity = error</code>.</p>
        <p>Its limitation is worth knowing: it can only fire when the callee <em>accepts</em> a token.
        If one of your own layers does not take one, the chain breaks there silently and no analyser
        complains — so adding the parameter is itself part of the fix.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A service's memory grows about 1.4 GB per day, never falls, is unaffected by load dropping to
    zero overnight, and is cleared by a restart. Concurrency is flat. What is your first hypothesis,
    and how do you confirm it?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  10,000 linked sources against one long-lived parent token:
    not disposed :   1,406 KB retained
    disposed     :       0 KB retained</code></pre>
        <p><strong>The shape of the graph is the diagnosis.</strong> Memory that tracks
        <em>cumulative work since start</em> rather than concurrency, and that does not fall when load
        does, is an accumulation keyed to a long-lived root — not a working-set problem and not
        pressure.</p>
        <p><strong>First hypothesis: registrations on a process-lifetime token.</strong>
        <code>CreateLinkedTokenSource</code> registers a callback on each parent, and that
        registration lives as long as the parent, not the child. Against an application-stopping token
        or a connection-scoped one, an undisposed link is unbounded.</p>
        <pre data-lang="console" data-title="Confirming it"><code>dotnet-gcdump collect --process-id &lt;pid&gt;
# or in a dump:
&gt; dumpheap -stat -type CancellationToken
&gt; gcroot &lt;address of a CancellationTokenSource&gt;</code></pre>
        <p>A large and growing count of <code>CancellationTokenSource</code> objects, with
        <code>gcroot</code> showing them all held by one long-lived source, is conclusive.</p>
        <p><strong>The fix is <code>using</code></strong> on every
        <code>CreateLinkedTokenSource</code>, and disposing the
        <code>CancellationTokenRegistration</code> that <code>Register</code> returns — the return
        value people routinely discard.</p>
        <p><strong>The wider lesson</strong> is that "we restart it every week and it's fine" is
        always worth one hour of investigation. A restart clears exactly this class of defect, which
        is why it can survive for months in a service that deploys frequently, and why it surfaces
        catastrophically the first time a deployment is delayed.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write the test that would have caught the Ledger export bug, and explain which assertion is
    load-bearing.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="Solution"><code>[Fact]
public async Task ExportAsync_StopsEarly_WhenTheCallerCancels()
{
    var store = new StatementStore();
    var service = new ExportService(store);
    var statement = new Statement("ACC-1", PageCount: 50);

    using var cts = new CancellationTokenSource();
    cts.CancelAfter(TimeSpan.FromMilliseconds(50));

    await Assert.ThrowsAsync&lt;OperationCanceledException&gt;(
        () =&gt; service.ExportAsync(statement, cts.Token));

    Assert.True(store.PagesRendered &lt; statement.PageCount,
        $"rendered {store.PagesRendered} of {statement.PageCount} after cancelling");
}</code></pre>
        <p><strong>The second assertion is load-bearing; the first is nearly worthless.</strong></p>
        <p><code>Assert.ThrowsAsync&lt;OperationCanceledException&gt;</code> passes against the broken
        implementation. The broken version does throw — the first call in the chain receives the token
        and throws when it fires — so a test that checks only for the exception is satisfied by code
        that then renders every remaining page.</p>
        <p><strong>Asserting on observable work done</strong> is what separates "an exception came out"
        from "the work actually stopped". That requires the test double to count something, which is
        why <code>StatementStore</code> exposes <code>PagesRendered</code>. Designing for that
        observability is part of writing testable cancellation.</p>
        <p><strong>Two refinements for real use.</strong> Prefer a deterministic trigger to a timer
        where you can — cancel from inside a fake on the second call rather than using
        <code>CancelAfter</code> — because a 50 ms timer is a flaky test on a loaded build agent. And
        assert a bound rather than an exact count: the precise number of pages completed before
        cancellation is inherently racy, so <code>&lt; PageCount</code> is the right shape and
        <code>== 2</code> is not.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 03-production.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-cooperative.cs"><code>// 01-cooperative.cs — cancellation in .NET is COOPERATIVE. Nothing is stopped;
// something is asked to stop, and it stops only if it was written to notice.
// This file measures what happens when it was not.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-cooperative.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== 1. cancelling something that does not check ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            var sw = Stopwatch.StartNew();
            var work = Task.Run(() =&gt; IgnoresTheToken(cts.Token));
            cts.Cancel();                                  // cancel immediately
            var cancelledAt = sw.Elapsed.TotalMilliseconds;
            work.GetAwaiter().GetResult();

            Console.WriteLine($"  cancel() called at   : {cancelledAt,6:N0} ms");
            Console.WriteLine($"  work actually ended  : {sw.Elapsed.TotalMilliseconds,6:N0} ms");
            Console.WriteLine($"  token was cancelled  : {cts.Token.IsCancellationRequested}");
        }
        Console.WriteLine();
        Console.WriteLine("  The token was cancelled 500 ms before the work finished, and the");
        Console.WriteLine("  work finished anyway. Cancel() does not stop anything. It sets a");
        Console.WriteLine("  boolean and runs callbacks; that is the entire mechanism.");
        Console.WriteLine("  There is NO API in .NET that forcibly stops a running operation.");
        Console.WriteLine("  Thread.Abort existed and was removed in .NET Core because it could");
        Console.WriteLine("  not be made safe.");

        Console.WriteLine();
        Console.WriteLine("=== 2. the same work, written to notice ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            var sw = Stopwatch.StartNew();
            var work = Task.Run(() =&gt; ChecksTheToken(cts.Token));
            Thread.Sleep(50);
            cts.Cancel();
            var stoppedAt = 0.0;
            try { work.GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { stoppedAt = sw.Elapsed.TotalMilliseconds; }

            Console.WriteLine($"  cancel() at          : ~50 ms");
            Console.WriteLine($"  work stopped at      : {stoppedAt,6:N0} ms");
            Console.WriteLine($"  threw                : OperationCanceledException");
        }

        Console.WriteLine();
        Console.WriteLine("=== 3. the two ways to check, and when each is right ===");
        Console.WriteLine();
        Console.WriteLine("  ThrowIfCancellationRequested()  — the default. Throws");
        Console.WriteLine("    OperationCanceledException, which callers and the framework");
        Console.WriteLine("    already understand as 'cancelled', not 'failed'.");
        Console.WriteLine();
        Console.WriteLine("  if (token.IsCancellationRequested) — when you must clean up, return");
        Console.WriteLine("    a partial result, or stop a loop without unwinding. Rarer than it");
        Console.WriteLine("    looks: if you return normally after a cancellation, the caller");
        Console.WriteLine("    cannot tell the difference between 'finished' and 'gave up'.");
        Console.WriteLine();

        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            Console.WriteLine($"  returned partial     : {PartialResult(cts.Token)} of 1000 items");
            Console.WriteLine("  ...and the caller has no idea this is incomplete. If you take");
            Console.WriteLine("  this route, the return type must say so — a status enum, or a");
            Console.WriteLine("  tuple carrying 'was cancelled'.");
        }

        Console.WriteLine();
        Console.WriteLine("=== 4. what the exception type actually is ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();

            Report("token.ThrowIfCancellationRequested()", () =&gt; cts.Token.ThrowIfCancellationRequested());
            Report("await Task.Delay(1000, token)",
                () =&gt; Task.Delay(1000, cts.Token).GetAwaiter().GetResult());
            Report("Task.FromCanceled(token)",
                () =&gt; Task.FromCanceled(cts.Token).GetAwaiter().GetResult());
        }
        Console.WriteLine();
        Console.WriteLine("  TaskCanceledException DERIVES from OperationCanceledException, so");
        Console.WriteLine("  catching the base type catches both. Catch the base type. Code that");
        Console.WriteLine("  catches only TaskCanceledException misses direct token throws, which");
        Console.WriteLine("  is a real and common bug.");

        Console.WriteLine();
        Console.WriteLine("=== 5. cancellation is not failure ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            var t = Task.Run(() =&gt; ChecksTheToken(cts.Token), cts.Token);
            try { t.GetAwaiter().GetResult(); } catch (OperationCanceledException) { }
            Console.WriteLine($"  task status          : {t.Status}");
            Console.WriteLine($"  IsCanceled           : {t.IsCanceled}");
            Console.WriteLine($"  IsFaulted            : {t.IsFaulted}");
        }
        Console.WriteLine();
        Console.WriteLine("  Canceled is its OWN terminal state, distinct from Faulted. This");
        Console.WriteLine("  matters operationally: a cancelled request is not an error, and");
        Console.WriteLine("  logging it as one turns every user who closed a browser tab into a");
        Console.WriteLine("  page in your error budget.");

        Console.WriteLine();
        Console.WriteLine("=== 6. which token the exception carries ===");
        Console.WriteLine();
        Console.WriteLine("  A widely repeated claim is that throwing a bare");
        Console.WriteLine("  OperationCanceledException makes the task FAULT rather than cancel.");
        Console.WriteLine("  On .NET 10 that is not what happens. Measured:");
        Console.WriteLine();
        Console.WriteLine("  case                              status      oce.Token == ct");
        ShowThrow("Task.Run body, OCE(ct)", useTaskRun: true, carry: true);
        ShowThrow("Task.Run body, bare OCE", useTaskRun: true, carry: false);
        ShowThrow("async method, OCE(ct)", useTaskRun: false, carry: true);
        ShowThrow("async method, bare OCE", useTaskRun: false, carry: false);
        Console.WriteLine();
        Console.WriteLine("  The STATUS is Canceled in all four. What differs is the token the");
        Console.WriteLine("  exception carries, and that is what you actually need, because it is");
        Console.WriteLine("  how you answer the question that matters at a catch site:");
        Console.WriteLine();
        Console.WriteLine("      catch (OperationCanceledException ex) when (ex.CancellationToken == ct)");
        Console.WriteLine("          // the caller asked us to stop: not an error, do not retry");
        Console.WriteLine("      catch (OperationCanceledException)");
        Console.WriteLine("          // something ELSE cancelled - a timeout, most likely");
        Console.WriteLine();
        Console.WriteLine("  Without the token, those two are indistinguishable, and a timeout");
        Console.WriteLine("  gets silently reported as a user cancellation. That distinction is");
        Console.WriteLine("  the whole subject of 02-linking-and-timeouts.cs.");
        Console.WriteLine("  Use ThrowIfCancellationRequested(): it carries the token for free.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    /// &lt;summary&gt;
    /// Starts work that is already running, cancels its token, then throws an
    /// OperationCanceledException that either does or does not carry that token.
    /// The task must be RUNNING when Cancel lands, or Task.Run cancels it before
    /// the body executes and every case reads the same.
    /// &lt;/summary&gt;
    static void ShowThrow(string label, bool useTaskRun, bool carry)
    {
        using var cts = new CancellationTokenSource();
        using var started = new ManualResetEventSlim(false);
        var ct = cts.Token;

        Task task = useTaskRun
            ? Task.Run(() =&gt;
              {
                  started.Set();
                  Thread.Sleep(60);
                  throw carry ? new OperationCanceledException(ct)
                              : new OperationCanceledException();
              }, ct)
            : ThrowingBodyAsync(ct, carry, started);

        started.Wait();
        cts.Cancel();

        var carriesToken = false;
        try { task.GetAwaiter().GetResult(); }
        catch (OperationCanceledException ex) { carriesToken = ex.CancellationToken == ct; }
        catch { }

        Console.WriteLine($"  {label,-34}{task.Status,-12}{carriesToken}");
    }

    static async Task ThrowingBodyAsync(CancellationToken ct, bool carry, ManualResetEventSlim started)
    {
        started.Set();
        await Task.Delay(60).ConfigureAwait(false);
        throw carry ? new OperationCanceledException(ct) : new OperationCanceledException();
    }

    static void IgnoresTheToken(CancellationToken ct)
    {
        var end = Stopwatch.StartNew();
        while (end.ElapsedMilliseconds &lt; 500) _sink++;      // never looks at ct
    }

    static void ChecksTheToken(CancellationToken ct)
    {
        var end = Stopwatch.StartNew();
        while (end.ElapsedMilliseconds &lt; 500)
        {
            ct.ThrowIfCancellationRequested();
            _sink++;
        }
    }

    static int PartialResult(CancellationToken ct)
    {
        var done = 0;
        for (var i = 0; i &lt; 1000; i++)
        {
            if (ct.IsCancellationRequested) break;          // returns quietly
            done++;
        }
        return done;
    }

    static void Report(string label, Action a)
    {
        try { a(); Console.WriteLine($"  {label,-38} did not throw"); }
        catch (Exception ex)
        {
            var isBase = ex is OperationCanceledException;
            Console.WriteLine($"  {label,-38} {ex.GetType().Name}" +
                              $"{(isBase ? "  (is an OperationCanceledException)" : "")}");
        }
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="02-linking-and-timeouts.cs"><code>// 02-linking-and-timeouts.cs — combining a caller's token with your own timeout,
// telling afterwards WHICH one fired, and the leak that linked sources cause when
// nobody disposes them.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-linking-and-timeouts.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine("=== 1. one operation, two reasons to stop ===");
        Console.WriteLine();
        Console.WriteLine("  Almost every real call has both: the caller may give up, AND you");
        Console.WriteLine("  have a deadline of your own. CreateLinkedTokenSource combines them");
        Console.WriteLine("  into one token that is cancelled when EITHER fires.");
        Console.WriteLine();
        Console.WriteLine("  scenario                      outcome                    ms");

        RunScenario("caller cancels at 60 ms", callerCancelMs: 60, timeoutMs: 500, workMs: 1000);
        RunScenario("timeout fires at 100 ms", callerCancelMs: -1, timeoutMs: 100, workMs: 1000);
        RunScenario("work finishes first", callerCancelMs: -1, timeoutMs: 500, workMs: 60);

        Console.WriteLine();
        Console.WriteLine("  Note the outcome column. All three are distinguished, and that is");
        Console.WriteLine("  the point: 'cancelled' and 'timed out' need different handling.");
        Console.WriteLine("  A caller cancellation is not an error and must not be retried — the");
        Console.WriteLine("  caller has gone. A timeout IS a failure of your dependency, should");
        Console.WriteLine("  be logged, may be retried, and belongs in your error budget.");

        Console.WriteLine();
        Console.WriteLine("=== 2. how to tell them apart ===");
        Console.WriteLine();
        Console.WriteLine("  The linked token is a THIRD token. Comparing the exception against");
        Console.WriteLine("  it tells you nothing, because it is cancelled in both cases. You");
        Console.WriteLine("  have to ask the ORIGINAL sources which one fired:");
        Console.WriteLine();
        Console.WriteLine("      catch (OperationCanceledException) when (caller.IsCancellationRequested)");
        Console.WriteLine("          -&gt; the caller gave up");
        Console.WriteLine("      catch (OperationCanceledException)");
        Console.WriteLine("          -&gt; our own timeout fired");
        Console.WriteLine();
        Console.WriteLine("  Order matters: check the caller FIRST. If both fired, the caller");
        Console.WriteLine("  going away is the more useful explanation, and it is the one that");
        Console.WriteLine("  should not page anyone.");

        Console.WriteLine();
        Console.WriteLine("=== 3. CancelAfter on a source you already own ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.CancelAfter(80);
            var sw = Stopwatch.StartNew();
            try
            {
                Task.Delay(1000, cts.Token).GetAwaiter().GetResult();
                Console.WriteLine("  completed (unexpected)");
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine($"  CancelAfter(80) fired at : {sw.Elapsed.TotalMilliseconds:N0} ms");
            }
        }
        Console.WriteLine("  CancelAfter is a timer on the source. It is the shortest way to");
        Console.WriteLine("  express a deadline, and there is also a constructor overload:");
        Console.WriteLine("      new CancellationTokenSource(TimeSpan.FromSeconds(5))");

        Console.WriteLine();
        Console.WriteLine("=== 4. the leak: linked sources are IDisposable for a reason ===");
        Console.WriteLine();
        Console.WriteLine("  A linked source REGISTERS a callback on each token it links. If you");
        Console.WriteLine("  do not dispose it, that registration stays on the parent token for");
        Console.WriteLine("  as long as the PARENT lives — not as long as the child lives.");
        Console.WriteLine();
        Console.WriteLine("  10,000 linked sources created against one long-lived parent token:");
        Console.WriteLine();
        Console.WriteLine("  variant                        KB retained by the parent");
        Console.WriteLine($"  not disposed                   {MeasureLinkedLeak(dispose: false),10:N0}");
        Console.WriteLine($"  disposed                       {MeasureLinkedLeak(dispose: true),10:N0}");
        Console.WriteLine();
        Console.WriteLine("  This is the classic slow leak in a long-running service: a token");
        Console.WriteLine("  that lives for the process lifetime — an application-stopping token,");
        Console.WriteLine("  a connection-scoped token — accumulating one registration per");
        Console.WriteLine("  request, forever. Memory climbs with total requests served rather");
        Console.WriteLine("  than with concurrency, which is a very distinctive shape on a graph.");
        Console.WriteLine();
        Console.WriteLine("      // Wrong: leaks a registration on ct for the life of ct.");
        Console.WriteLine("      var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);");
        Console.WriteLine();
        Console.WriteLine("      // Right:");
        Console.WriteLine("      using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);");
        Console.WriteLine();
        Console.WriteLine("  The same applies to token.Register(...): the returned registration");
        Console.WriteLine("  must be disposed, and it is the return value people discard.");

        Console.WriteLine();
        Console.WriteLine("=== 5. CancellationToken.None and default ===");
        Console.WriteLine();
        Console.WriteLine($"  default(CancellationToken) == CancellationToken.None : " +
                          $"{default(CancellationToken) == CancellationToken.None}");
        Console.WriteLine($"  CanBeCanceled on None                               : " +
                          $"{CancellationToken.None.CanBeCanceled}");
        Console.WriteLine();
        Console.WriteLine("  They are EQUAL. Anyone who tells you otherwise is wrong, and the");
        Console.WriteLine("  first line above is the check. The difference is one of INTENT.");
        Console.WriteLine("  CancellationToken.None at a call site says 'this genuinely cannot");
        Console.WriteLine("  be cancelled and I decided that'. A defaulted parameter usually");
        Console.WriteLine("  means nobody thought about it. Reviewers can act on the first.");
        Console.WriteLine();
        Console.WriteLine("  CanBeCanceled is worth knowing for a different reason: it is false");
        Console.WriteLine("  for None, so a library can skip registering callbacks entirely when");
        Console.WriteLine("  it sees a token that can never fire.");
    }

    static void RunScenario(string label, int callerCancelMs, int timeoutMs, int workMs)
    {
        using var caller = new CancellationTokenSource();
        if (callerCancelMs &gt; 0) caller.CancelAfter(callerCancelMs);

        var sw = Stopwatch.StartNew();
        string outcome;
        try
        {
            DoWorkAsync(workMs, TimeSpan.FromMilliseconds(timeoutMs), caller.Token)
                .GetAwaiter().GetResult();
            outcome = "completed";
        }
        catch (OperationCanceledException) when (caller.IsCancellationRequested)
        {
            outcome = "cancelled by caller";
        }
        catch (OperationCanceledException)
        {
            outcome = "timed out";
        }

        Console.WriteLine($"  {label,-28}  {outcome,-24} {sw.Elapsed.TotalMilliseconds,5:N0}");
    }

    /// &lt;summary&gt;
    /// The standard shape: link the caller's token with a deadline of our own,
    /// pass the LINKED token down, and dispose it when done.
    /// &lt;/summary&gt;
    static async Task DoWorkAsync(int workMs, TimeSpan timeout, CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(timeout);
        await Task.Delay(workMs, linked.Token).ConfigureAwait(false);
    }

    static long MeasureLinkedLeak(bool dispose)
    {
        var parent = new CancellationTokenSource();          // stands in for a long-lived token

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var before = GC.GetTotalMemory(forceFullCollection: true);

        // Nothing here holds a reference to the linked sources: they go out of
        // scope immediately, exactly as they would in a request handler. If they
        // survive the collection below, it is the PARENT token retaining them
        // through its registration list, which is the whole point.
        // An earlier version of this measurement kept them in a List and was
        // therefore measuring the List rather than the leak.
        CreateAndDrop(parent.Token, dispose);

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var after = GC.GetTotalMemory(forceFullCollection: true);

        GC.KeepAlive(parent);
        parent.Dispose();
        return (after - before) / 1024;
    }

    [System.Runtime.CompilerServices.MethodImpl(
        System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static void CreateAndDrop(CancellationToken parent, bool dispose)
    {
        for (var i = 0; i &lt; 10_000; i++)
        {
            var linked = CancellationTokenSource.CreateLinkedTokenSource(parent);
            if (dispose) linked.Dispose();
            // else: dropped on the floor, unreferenced by anything we own
        }
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — Ledger's statement export: a token that was accepted at the
// top and dropped one layer down, and what that costs when clients give up.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Statements;

public sealed record Statement(string AccountId, int PageCount);

/// &lt;summary&gt;Stands in for the reporting database. Each page costs real work.&lt;/summary&gt;
public sealed class StatementStore
{
    private int _pagesRendered;
    public int PagesRendered =&gt; Volatile.Read(ref _pagesRendered);
    public void Reset() =&gt; Volatile.Write(ref _pagesRendered, 0);

    public async Task&lt;string&gt; RenderPageAsync(int page, CancellationToken ct = default)
    {
        await Task.Delay(20, ct).ConfigureAwait(false);
        Interlocked.Increment(ref _pagesRendered);
        return $"page-{page}";
    }
}

/// &lt;summary&gt;
/// THE BUG. The endpoint accepts a token and passes it to the FIRST call, then
/// drops it. Everything after that runs to completion regardless.
/// &lt;/summary&gt;
public sealed class ExportServiceV1
{
    private readonly StatementStore _store;
    public ExportServiceV1(StatementStore store) =&gt; _store = store;

    public async Task&lt;int&gt; ExportAsync(Statement statement, CancellationToken ct = default)
    {
        var pages = new List&lt;string&gt;();
        for (var i = 0; i &lt; statement.PageCount; i++)
        {
            // The token is not passed. Nothing here can ever stop early.
            pages.Add(await _store.RenderPageAsync(i).ConfigureAwait(false));
        }
        return pages.Count;
    }
}

/// &lt;summary&gt;THE FIX. The token reaches every awaited call and every loop iteration.&lt;/summary&gt;
public sealed class ExportServiceV2
{
    private readonly StatementStore _store;
    public ExportServiceV2(StatementStore store) =&gt; _store = store;

    public async Task&lt;int&gt; ExportAsync(Statement statement, CancellationToken ct = default)
    {
        var pages = new List&lt;string&gt;();
        for (var i = 0; i &lt; statement.PageCount; i++)
        {
            ct.ThrowIfCancellationRequested();
            pages.Add(await _store.RenderPageAsync(i, ct).ConfigureAwait(false));
        }
        return pages.Count;
    }
}

class Program
{
    const int Requests = 60;
    const int PagesPerStatement = 50;
    const int ClientGivesUpAfterMs = 120;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger's statement export renders 50 pages per account. The endpoint");
        Console.WriteLine("  takes a CancellationToken, as every ASP.NET Core action does:");
        Console.WriteLine();
        Console.WriteLine("      public async Task&lt;IActionResult&gt; Export(string id, CancellationToken ct)");
        Console.WriteLine("          =&gt; Ok(await _export.ExportAsync(statement, ct));");
        Console.WriteLine();
        Console.WriteLine("  That token is ASP.NET Core's HttpContext.RequestAborted. It fires");
        Console.WriteLine("  when the client disconnects — closes the tab, loses signal, or hits");
        Console.WriteLine("  a gateway timeout upstream of you.");
        Console.WriteLine();
        Console.WriteLine("  The endpoint passed it correctly. One layer down, a loop did not.");
        Console.WriteLine();
        Console.WriteLine($"  {Requests} clients request an export and give up after {ClientGivesUpAfterMs} ms:");
        Console.WriteLine();
        Console.WriteLine("  version                     pages rendered   of possible   total ms");

        var store = new StatementStore();
        Report("token dropped in the loop", Measure(store,
            (svc, s, ct) =&gt; new ExportServiceV1(store).ExportAsync(s, ct)));
        Report("token threaded through", Measure(store,
            (svc, s, ct) =&gt; new ExportServiceV2(store).ExportAsync(s, ct)));

        Console.WriteLine();
        Console.WriteLine("  The first version rendered every page anyway, because the only thing");
        Console.WriteLine("  that could have stopped it was a parameter accepted at the top of the");
        Console.WriteLine("  call and never used again. The second stopped within one page of the");
        Console.WriteLine("  client giving up.");
        Console.WriteLine();
        Console.WriteLine("  Every client had gone in BOTH runs, so every page rendered in either");
        Console.WriteLine("  column was wasted. The column says how much work was done before");
        Console.WriteLine("  stopping: 100% against 8%. That gap is capacity you paid for and");
        Console.WriteLine("  spent producing output with no recipient —");
        Console.WriteLine("  and it is spent at exactly the moment you can least afford it,");
        Console.WriteLine("  because clients give up when you are ALREADY slow.");

        Console.WriteLine();
        Console.WriteLine("=== the feedback loop this creates ===");
        Console.WriteLine();
        Console.WriteLine("  1. Something makes the service slow. Latency rises.");
        Console.WriteLine("  2. Clients hit their timeouts and disconnect.");
        Console.WriteLine("  3. Their work keeps running, because the token went nowhere.");
        Console.WriteLine("  4. That work competes with the retries those clients now send.");
        Console.WriteLine("  5. Latency rises further. Go to 2.");
        Console.WriteLine();
        Console.WriteLine("  This is why an outage that should have been a brief slowdown becomes");
        Console.WriteLine("  a sustained one that does not recover until traffic is shed. A");
        Console.WriteLine("  correctly threaded token breaks the loop at step 3: abandoned work");
        Console.WriteLine("  stops, and capacity is returned in time to serve the retries.");

        Console.WriteLine();
        Console.WriteLine("=== why it survived review ===");
        Console.WriteLine();
        Console.WriteLine("  Nothing about the broken version LOOKS broken. It accepts a token,");
        Console.WriteLine("  it has the right signature, it passes the analyser rules that check");
        Console.WriteLine("  for a token parameter. The defect is an absence — an argument not");
        Console.WriteLine("  passed at one call site out of several.");
        Console.WriteLine();
        Console.WriteLine("  There is no test that fails, either, unless somebody wrote one that");
        Console.WriteLine("  cancels mid-flight and asserts the work stopped. Almost nobody does:");
        Console.WriteLine("  a cancellation test looks like a test of the framework rather than");
        Console.WriteLine("  of your code.");
        Console.WriteLine();
        Console.WriteLine("  What DOES catch it, cheaply:");
        Console.WriteLine();
        Console.WriteLine("    CA2016  'Forward the CancellationToken parameter to methods that");
        Console.WriteLine("             take one'. Built into the .NET analysers, off by default");
        Console.WriteLine("             at warning level in some templates. Turn it on and treat");
        Console.WriteLine("             it as an error.");
        Console.WriteLine();
        Console.WriteLine("    A test that cancels halfway and asserts on work done:");
        Console.WriteLine();
        Console.WriteLine("      using var cts = new CancellationTokenSource();");
        Console.WriteLine("      cts.CancelAfter(TimeSpan.FromMilliseconds(50));");
        Console.WriteLine("      await Assert.ThrowsAsync&lt;OperationCanceledException&gt;(");
        Console.WriteLine("          () =&gt; service.ExportAsync(statement, cts.Token));");
        Console.WriteLine("      Assert.True(store.PagesRendered &lt; statement.PageCount);");
        Console.WriteLine();
        Console.WriteLine("  The second assertion is the important one. Without it the test");
        Console.WriteLine("  passes on the broken version too, because the exception is thrown by");
        Console.WriteLine("  the FIRST call, which does receive the token.");

        Console.WriteLine();
        Console.WriteLine("=== the second bug in the same service ===");
        Console.WriteLine();
        Console.WriteLine("  A background reconciliation loop linked every job's token to the");
        Console.WriteLine("  host's application-stopping token, and never disposed the link:");
        Console.WriteLine();
        Console.WriteLine("      var linked = CancellationTokenSource.CreateLinkedTokenSource(");
        Console.WriteLine("          _appStopping, jobCts.Token);          // no using");
        Console.WriteLine();
        Console.WriteLine("  _appStopping lives for the life of the process, so every job left a");
        Console.WriteLine("  registration on it permanently.");
        Console.WriteLine();
        Console.WriteLine($"  10,000 jobs, undisposed : {Leak(dispose: false),8:N0} KB retained");
        Console.WriteLine($"  10,000 jobs, disposed   : {Leak(dispose: true),8:N0} KB retained");
        Console.WriteLine();
        Console.WriteLine("  The signature of this leak is distinctive and worth memorising:");
        Console.WriteLine("  memory grows with TOTAL WORK DONE SINCE START rather than with");
        Console.WriteLine("  concurrency, it never falls, and it is unaffected by load dropping");
        Console.WriteLine("  to zero. A restart 'fixes' it, which is why it can survive for");
        Console.WriteLine("  months in a service that deploys weekly.");
    }

    readonly record struct Result(int Pages, int Possible, double TotalMs);

    static Result Measure(StatementStore store,
                          Func&lt;object?, Statement, CancellationToken, Task&lt;int&gt;&gt; export)
    {
        Thread.Sleep(200);
        store.Reset();
        var statement = new Statement("ACC-1", PagesPerStatement);

        var sw = Stopwatch.StartNew();
        Task.WhenAll(Enumerable.Range(0, Requests).Select(async _ =&gt;
        {
            using var client = new CancellationTokenSource();
            client.CancelAfter(ClientGivesUpAfterMs);          // the client gives up
            try { await export(null, statement, client.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        })).GetAwaiter().GetResult();
        sw.Stop();

        return new Result(store.PagesRendered, Requests * PagesPerStatement,
                          sw.Elapsed.TotalMilliseconds);
    }

    static void Report(string label, Result r)
    {
        var share = 100.0 * r.Pages / r.Possible;
        Console.WriteLine($"  {label,-27} {r.Pages,5:N0} of {r.Possible,5:N0}   {share,10:N0}%   " +
                          $"{r.TotalMs,8:N0}");
    }

    static long Leak(bool dispose)
    {
        var appStopping = new CancellationTokenSource();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var before = GC.GetTotalMemory(forceFullCollection: true);

        CreateJobs(appStopping.Token, dispose);

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var after = GC.GetTotalMemory(forceFullCollection: true);

        GC.KeepAlive(appStopping);
        appStopping.Dispose();
        return (after - before) / 1024;
    }

    [System.Runtime.CompilerServices.MethodImpl(
        System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static void CreateJobs(CancellationToken appStopping, bool dispose)
    {
        for (var i = 0; i &lt; 10_000; i++)
        {
            var jobCts = new CancellationTokenSource();
            var linked = CancellationTokenSource.CreateLinkedTokenSource(appStopping, jobCts.Token);
            if (dispose) { linked.Dispose(); jobCts.Dispose(); }
        }
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs"><code>// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;
    static int _pages;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: does cancelling stop it? =====");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            var sw = Stopwatch.StartNew();
            var t = Task.Run(() =&gt; { var e = Stopwatch.StartNew();
                                     while (e.ElapsedMilliseconds &lt; 300) _sink++; });
            cts.Cancel();
            t.GetAwaiter().GetResult();
            Console.WriteLine($"  cancelled at ~0 ms, work ended at {sw.Elapsed.TotalMilliseconds:N0} ms");
        }
        Console.WriteLine("  No. Cancel() sets a flag and runs callbacks. Work that never looks");
        Console.WriteLine("  at the token runs to completion. Cancellation is COOPERATIVE, and");
        Console.WriteLine("  there is no API in .NET that forcibly stops running code.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: which exception, and is it an error? =====");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            Console.WriteLine($"  ThrowIfCancellationRequested -&gt; {Caught(() =&gt; cts.Token.ThrowIfCancellationRequested())}");
            Console.WriteLine($"  Task.Delay(1000, token)      -&gt; {Caught(() =&gt; Task.Delay(1000, cts.Token).GetAwaiter().GetResult())}");
        }
        Console.WriteLine();
        Console.WriteLine("  TaskCanceledException derives from OperationCanceledException, so");
        Console.WriteLine("  catch the BASE type — catching only TaskCanceledException misses");
        Console.WriteLine("  direct token throws.");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            var t = Task.Run(() =&gt; cts.Token.ThrowIfCancellationRequested(), cts.Token);
            try { t.GetAwaiter().GetResult(); } catch (OperationCanceledException) { }
            Console.WriteLine($"  task status {t.Status}, IsFaulted={t.IsFaulted}");
        }
        Console.WriteLine("  Canceled is its own terminal state, NOT Faulted. A cancelled request");
        Console.WriteLine("  is not an error; logging it as one puts every abandoned browser tab");
        Console.WriteLine("  into your error budget.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: caller cancellation or timeout? =====");
        Console.WriteLine();
        Console.WriteLine("  scenario                      outcome");
        Which("caller cancels at 50 ms", callerMs: 50, timeoutMs: 400);
        Which("timeout at 80 ms", callerMs: -1, timeoutMs: 80);
        Console.WriteLine();
        Console.WriteLine("  The LINKED token is cancelled in both cases, so testing it tells you");
        Console.WriteLine("  nothing. You must ask the original source:");
        Console.WriteLine();
        Console.WriteLine("      catch (OperationCanceledException) when (caller.IsCancellationRequested)");
        Console.WriteLine("          -&gt; caller gave up: not an error, do not retry");
        Console.WriteLine("      catch (OperationCanceledException)");
        Console.WriteLine("          -&gt; our timeout fired: a real failure, log it, maybe retry");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: find the bug =====");
        Console.WriteLine();
        Console.WriteLine("  This method accepts a token and is still uncancellable. Why?");
        Console.WriteLine();
        Console.WriteLine("      for (var i = 0; i &lt; pages; i++)");
        Console.WriteLine("          results.Add(await RenderAsync(i));    // no ct");
        Console.WriteLine();
        Volatile.Write(ref _pages, 0);
        RunUntilCancelled(dropped: true);
        var dropped = Volatile.Read(ref _pages);
        Volatile.Write(ref _pages, 0);
        RunUntilCancelled(dropped: false);
        var threaded = Volatile.Read(ref _pages);
        Console.WriteLine($"  token dropped   : {dropped,3} of 30 pages rendered after cancellation");
        Console.WriteLine($"  token threaded  : {threaded,3} of 30 pages rendered after cancellation");
        Console.WriteLine();
        Console.WriteLine("  The parameter exists and is never used. CA2016 catches exactly this");
        Console.WriteLine("  ('Forward the CancellationToken parameter to methods that take one')");
        Console.WriteLine("  and it is the single highest-value analyser rule in this module.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: the leak =====");
        Console.WriteLine();
        Console.WriteLine("  10,000 linked sources against one long-lived parent token:");
        Console.WriteLine($"    not disposed : {Leak(false),7:N0} KB retained");
        Console.WriteLine($"    disposed     : {Leak(true),7:N0} KB retained");
        Console.WriteLine();
        Console.WriteLine("  CreateLinkedTokenSource registers a callback on each parent token.");
        Console.WriteLine("  The registration lives as long as the PARENT, not the child. Against");
        Console.WriteLine("  a process-lifetime token that is an unbounded leak.");
        Console.WriteLine();
        Console.WriteLine("  Its signature: memory grows with total requests served, never falls,");
        Console.WriteLine("  and is unaffected by load dropping to zero. A restart hides it.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static string Caught(Action a)
    {
        try { a(); return "did not throw"; }
        catch (Exception ex) { return ex.GetType().Name; }
    }

    static void Which(string label, int callerMs, int timeoutMs)
    {
        using var caller = new CancellationTokenSource();
        if (callerMs &gt; 0) caller.CancelAfter(callerMs);
        string outcome;
        try
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(caller.Token);
            linked.CancelAfter(timeoutMs);
            Task.Delay(2000, linked.Token).GetAwaiter().GetResult();
            outcome = "completed";
        }
        catch (OperationCanceledException) when (caller.IsCancellationRequested)
        {
            outcome = "cancelled by caller";
        }
        catch (OperationCanceledException)
        {
            outcome = "timed out";
        }
        Console.WriteLine($"  {label,-28}  {outcome}");
    }

    static void RunUntilCancelled(bool dropped)
    {
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(60);
        try
        {
            (dropped ? ExportDroppedAsync(30, cts.Token) : ExportThreadedAsync(30, cts.Token))
                .GetAwaiter().GetResult();
        }
        catch (OperationCanceledException) { }
    }

    static async Task ExportDroppedAsync(int pages, CancellationToken ct)
    {
        for (var i = 0; i &lt; pages; i++)
        {
            await Task.Delay(20).ConfigureAwait(false);       // token not passed
            Interlocked.Increment(ref _pages);
        }
    }

    static async Task ExportThreadedAsync(int pages, CancellationToken ct)
    {
        for (var i = 0; i &lt; pages; i++)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(20, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _pages);
        }
    }

    static long Leak(bool dispose)
    {
        var parent = new CancellationTokenSource();
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        Create(parent.Token, dispose);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var after = GC.GetTotalMemory(true);
        GC.KeepAlive(parent);
        parent.Dispose();
        return (after - before) / 1024;
    }

    [System.Runtime.CompilerServices.MethodImpl(
        System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static void Create(CancellationToken parent, bool dispose)
    {
        for (var i = 0; i &lt; 10_000; i++)
        {
            var linked = CancellationTokenSource.CreateLinkedTokenSource(parent);
            if (dispose) linked.Dispose();
        }
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does <code>Cancel()</code> actually do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Sets a boolean and runs registered callbacks. Nothing more. Measured: work cancelled at
        0 ms ran to completion at 505 ms because it never checked its token.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between a <code>CancellationToken</code> and a
      <code>CancellationTokenSource</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The source can cancel; the token can only observe. You hand out tokens and keep the source,
        so that code you call cannot cancel on your behalf.</p>
      </div></details>
    </li>
    <li>
      <p>Which exception should you catch, and why?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>OperationCanceledException</code> — the base type.
        <code>TaskCanceledException</code> derives from it, and
        <code>ThrowIfCancellationRequested</code> throws the base directly, so catching only the
        derived type misses it.</p>
      </div></details>
    </li>
    <li>
      <p>Is a cancelled task a faulted task?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. <code>Canceled</code> is its own terminal state — <code>IsCanceled</code> true,
        <code>IsFaulted</code> false. Counting cancellations as errors puts every abandoned browser
        tab in your error budget.</p>
      </div></details>
    </li>
    <li>
      <p>How do you combine a caller's token with your own timeout, and then tell which fired?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>CreateLinkedTokenSource(ct)</code> plus <code>CancelAfter</code>. To distinguish
        them, ask the <em>original</em> source — <code>when (caller.IsCancellationRequested)</code> —
        because the linked token is cancelled in both cases. Check the caller first.</p>
      </div></details>
    </li>
    <li>
      <p>Why must a linked source be disposed?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It registers a callback on each parent token, and that registration lives as long as the
        <strong>parent</strong>. Against a process-lifetime token it is an unbounded leak: measured at
        1,406 KB per 10,000 links with nothing else holding a reference.</p>
      </div></details>
    </li>
    <li>
      <p>A method takes a <code>CancellationToken</code>. Is it cancellable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Not necessarily — taking one and forwarding one are different. The Ledger method accepted a
        token, passed review, and still rendered <strong>3,000 of 3,000 pages</strong> after every
        client had disconnected.</p>
      </div></details>
    </li>
    <li>
      <p>Which analyser rule catches that, and what is its blind spot?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>CA2016</strong>, "forward the CancellationToken parameter". Its blind spot is that
        it can only fire when the callee accepts a token — if one of your own layers has no token
        parameter, the chain breaks there and nothing complains.</p>
      </div></details>
    </li>
    <li>
      <p>Why does dropped cancellation turn a slowdown into a sustained outage?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Timeouts produce retries while the abandoned work keeps running, so load rises <em>because</em>
        you are slow. Threading the token breaks the loop: abandoned work stops and capacity returns
        in time to serve the retries.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>Assert.ThrowsAsync&lt;OperationCanceledException&gt;</code> insufficient as a
      cancellation test?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It passes on the broken implementation, because the first call in the chain does receive
        the token and throws. You must also assert on <strong>observable work done</strong> — that
        fewer pages were rendered than requested.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
