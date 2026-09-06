CSPREP.module({
  id: "t2-06-synchronizationcontext",
  minutes: 55,
  updated: "2026-08-31",
  summary: "A SynchronizationContext is one method — Post — meaning 'run this wherever I say work runs', and every await silently captures it. ASP.NET Core and console apps have none, which is why the deadlock this causes is invisible for months and then permanent the moment a UI host consumes your library. ConfigureAwait(false) costs nothing measurable, does not disturb AsyncLocal, and has to be on every await rather than the first.",
  terms: ["SynchronizationContext", "context capture", "Post", "ConfigureAwait", "ExecutionContext",
    "AsyncLocal", "TaskScheduler", "sync over async", "deadlock", "thread affinity",
    "message pump", "library rule"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>You maintain a payments library. It has been in production for nine months across roughly two
  hundred services, handling several million transactions a day, with no reported defects in the
  async code. The test suite is thorough. Two separate code reviews signed off on it.</p>

  <p>In December a different team inside the company references the same package from a desktop
  application — a till used at branch counters. A cashier clicks "Take payment" and the window
  freezes. Not slowly: instantly and permanently. No exception is thrown. Nothing appears in the log.
  CPU usage is zero. The process must be killed from Task Manager.</p>

  <p>You cannot reproduce it. Your integration tests pass. Your load tests pass. You write a small
  console program that calls the library exactly the way the desktop team does, and it works
  perfectly, every time. You send it to them; on their machine, the same program inside their
  application hangs.</p>

  <p>The line they are calling is unremarkable and appears in a thousand codebases:</p>

  <pre data-lang="csharp" data-net="10" data-title="Their call site"><code>var receipt = _payments.PayAsync(payment).Result;</code></pre>

  <p>Nothing in your library's source hints at this. The difference is not in your code or in theirs.
  It is in an object neither of you has ever mentioned, which the desktop framework installs on its
  main thread at startup and which your <code>await</code> statements have been silently reading and
  obeying since the first release.</p>

  <p>That object is a <code>SynchronizationContext</code>. This module is about what it is, why
  modern .NET mostly does not have one, why that absence is what made the bug invisible for nine
  months, and what the rule <code>ConfigureAwait(false)</code> actually buys — measured, rather than
  repeated from a blog post.</p>
</section>

<section id="plain-language">
  <h2>What a context is</h2>

  <p class="define"><span class="define__term">Thread</span> An independent sequence of instructions
  the operating system can run. A process can have many, and which one your code is running on is
  usually invisible to you — until something requires a specific one.</p>

  <p class="define"><span class="define__term">SynchronizationContext</span> An object with one
  essential method, <code>Post(callback, state)</code>, meaning "here is some work; run it wherever
  work is supposed to run in this application". It is an abstraction over the question <em>where
  should code execute?</em>, and different application frameworks answer it differently.</p>

  <p class="define"><span class="define__term">Thread affinity</span> The property some objects have
  of being usable only from one specific thread. Windows UI controls are the classic example: reading
  a text box from any thread except the one that created it throws. Affinity is the reason contexts
  exist at all.</p>

  <p><strong>An analogy, and its limits.</strong> Think of a workshop where exactly one bench has the
  vice bolted to it. Anyone can do the thinking, the measuring, the ordering of parts — anywhere. But
  the moment a job needs the vice, it has to be carried to that bench, and only one person works
  there. A <code>SynchronizationContext</code> is the standing instruction "when you have finished
  waiting, bring the job back to the bench".</p>

  <p><strong>Where the analogy breaks:</strong> there is no supervisor enforcing it. The instruction
  is read <em>by each <code>await</code></em>, automatically, and obeyed without anyone writing code
  to do it. That invisibility is the whole difficulty — and the reason the same source text behaves
  differently in different applications.</p>

  <p>A UI framework implements <code>Post</code> by adding the callback to the message queue that its
  single UI thread pumps. So does the .NET Framework version of ASP.NET, which used a context to
  restore per-request state such as <code>HttpContext.Current</code>. <strong>ASP.NET Core does
  not.</strong> Neither does a console application, a worker service, or a test host. In modern
  server-side .NET, <code>SynchronizationContext.Current</code> is <code>null</code>.</p>

  <p class="define"><span class="define__term">Context capture</span> What every <code>await</code>
  does automatically before suspending: it reads <code>SynchronizationContext.Current</code> and
  stores it. When the awaited operation completes, the continuation is
  <code>Post</code>ed back to that context rather than run on a thread pool thread. If
  <code>Current</code> was <code>null</code>, there is nothing to capture and the continuation goes
  to the pool.</p>

  <p class="define"><span class="define__term">ConfigureAwait</span> A method on <code>Task</code>
  returning a differently-typed awaitable. <code>ConfigureAwait(false)</code> means "do not capture,
  do not restore — resume me anywhere". <code>ConfigureAwait(true)</code> is the default and means
  what a plain <code>await</code> already means.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <p>A console app has no context, so to see one at all you have to build it. This is a complete
  single-threaded context — the same shape WPF and WinForms provide — in about twenty lines:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — the smallest program that shows a context being
// captured, and ConfigureAwait(false) declining to capture it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine($"no context here      : {SynchronizationContext.Current?.ToString() ?? "null"}");

        var ui = new OneThreadContext();
        ui.Run(async () =&gt;
        {
            Console.WriteLine($"on the context thread: {Environment.CurrentManagedThreadId}");

            await Task.Delay(10);                          // captures the context
            Console.WriteLine($"after plain await    : {Environment.CurrentManagedThreadId}");

            await Task.Delay(10).ConfigureAwait(false);    // declines to capture
            Console.WriteLine($"after CA(false)      : {Environment.CurrentManagedThreadId}");
        });
    }
}

sealed class OneThreadContext : SynchronizationContext
{
    private readonly BlockingCollection&lt;(SendOrPostCallback, object?)&gt; _queue = new();

    public OneThreadContext() =&gt;
        new Thread(Pump) { IsBackground = true }.Start();

    private void Pump()
    {
        SetSynchronizationContext(this);
        foreach (var (callback, state) in _queue.GetConsumingEnumerable())
            callback(state);
    }

    public override void Post(SendOrPostCallback d, object? state) =&gt; _queue.Add((d, state));

    /// &lt;summary&gt;Starts the work on the context thread and waits WITHOUT blocking it.&lt;/summary&gt;
    public void Run(Func&lt;Task&gt; work)
    {
        var finished = new TaskCompletionSource();
        Post(async void (_) =&gt;
        {
            try { await work(); finished.TrySetResult(); }
            catch (Exception ex) { finished.TrySetException(ex); }
        }, null);
        finished.Task.Wait(2000);
        _queue.CompleteAdding();
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>no context here      : null
on the context thread: 4
after plain await    : 4
after CA(false)      : 6</code></pre>

  <p>Four lines of output containing the entire module.</p>

  <p><strong>Line 1.</strong> The console app's <code>Current</code> is <code>null</code>. This is the
  default in modern .NET and it is why most developers have never knowingly encountered a context.</p>

  <p><strong>Lines 2 and 3.</strong> The plain <code>await</code> resumed on thread 4 — the same
  thread it started on, and not a thread pool thread. That did not happen by itself: the operation
  completed on a timer thread, the continuation was <code>Post</code>ed to the context, and the
  context's pump loop picked it up. This is what a UI framework needs, because the code after the
  <code>await</code> is going to touch a control.</p>

  <p><strong>Line 4.</strong> <code>ConfigureAwait(false)</code> resumed on thread 6, an ordinary pool
  thread. The context was available and was declined.</p>

  <p>Note the shape of the <code>Run</code> helper, because it is not incidental. It starts the work
  on the context thread and then waits on a <code>TaskCompletionSource</code> from
  <em>outside</em> — it never blocks the context thread itself. The first version of the verification
  file for this module used a <code>ManualResetEventSlim</code> that the context thread waited on, and
  it hung on the first <code>await</code> and had to be killed. That is the deadlock this module is
  about, reproduced by accident while trying to demonstrate it.</p>
</section>

<section id="capture">
  <h2>What capture actually does</h2>

  <p>The mechanism is in the state machine from
  <a href="#/m/t2-05-async-state-machine">t2-05</a>. Before suspending, the generated code reads the
  current context and stores it; on completion it uses it to schedule the continuation. Roughly:</p>

  <pre data-lang="csharp" data-net="10" data-title="What the awaiter does, paraphrased"><code>// On suspension:
var capturedContext = SynchronizationContext.Current;      // unless ConfigureAwait(false)

// On completion:
if (capturedContext is not null &amp;&amp; capturedContext != SynchronizationContext.Current)
    capturedContext.Post(state =&gt; stateMachine.MoveNext(), null);
else
    ThreadPool.UnsafeQueueUserWorkItem(stateMachine, preferLocal: true);</code></pre>

  <p>Two details in that fall out as practical rules. First, the capture happens
  <strong>per await</strong>, not per method — each one reads <code>Current</code> independently.
  Second, if the context is already the current one, no <code>Post</code> is needed and the
  continuation runs directly, which is why resuming on a context you are already on is cheap.</p>

  <p>Running the full demonstration under a real context:</p>

  <pre data-lang="console" data-title="01-what-a-context-is.cs"><code>=== 1. a console app has NO context ===

  SynchronizationContext.Current : null
  no context                 resumed on thread 5 (pool thread = True)

=== 2. with a single-threaded context, as a UI app has ===

  inside the context, Current is : SingleThreadContext
  the context thread is          : 8
  captured                   resumed on thread 8 (pool thread = False)
  posts routed through the context : 2

=== 3. what 'capture' actually means ===

  started on thread            : 9
  after await (captured)       : 9  &lt;- back on the context thread
  after ConfigureAwait(false)  : 7  &lt;- a pool thread, context abandoned
  after a later plain await    : 7  &lt;- STILL a pool thread</code></pre>

  <p><strong>Read that last line carefully, because it contradicts the way most people describe
  <code>ConfigureAwait</code>.</strong> It is not a per-await setting that toggles behaviour for that
  await alone. It moves you <em>off</em> the context, and after that a later plain <code>await</code>
  has nothing left to capture — <code>Current</code> is now <code>null</code> on the pool thread you
  landed on. There is no automatic way back. If you need the context again, something has to
  <code>Post</code> to it explicitly.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong><code>TaskScheduler.Current</code> is a second, separate mechanism.</strong> An
    <code>await</code> captures the <code>SynchronizationContext</code> if there is one, and falls
    back to <code>TaskScheduler.Current</code> only if there is not. "No context" really means both
    are at their defaults — <code>null</code> and <code>ThreadPoolTaskScheduler</code>. This is why
    <code>ConfigureAwait(false)</code> changes nothing observable in a console app or in ASP.NET
    Core: there was never anything to capture.</p>
  </div>
</section>

<section id="the-deadlock">
  <h2>The deadlock, in three steps</h2>

  <p>A context with one thread. On that thread, someone calls <code>.Result</code> on a method that
  awaits without <code>ConfigureAwait(false)</code>:</p>

  <ol>
    <li>The <code>await</code> captures the context and suspends.</li>
    <li>The operation finishes and <code>Post</code>s the continuation to that context.</li>
    <li>The context's one thread is blocked inside <code>.Result</code>, waiting for the continuation
    it is itself preventing from running.</li>
  </ol>

  <p>Neither side can move. This is not a race and not a slow operation — it is permanent, and it
  survives any timeout you set on the underlying HTTP call, because the HTTP call already
  succeeded.</p>

  <pre data-lang="console" data-title="02-the-deadlock.cs"><code>  scenario                                        result       ms
  UI context, .Result, plain await               DEADLOCKED  1,524
  UI context, .Wait(), plain await               DEADLOCKED  1,503
  UI context, GetAwaiter().GetResult()           DEADLOCKED  1,509

  scenario                                        result       ms
  FIX 1: ConfigureAwait(false) in the library    completed      60
  FIX 2: await instead of blocking               completed      69
  FIX 3: no context to capture                   completed      61</code></pre>

  <p>Every "DEADLOCKED" row is a genuine deadlock; the 1,500 ms is only the timeout the verification
  file uses so it can report and move on.</p>

  <p>All three blocking spellings fail identically. <code>.Result</code>, <code>.Wait()</code> and
  <code>.GetAwaiter().GetResult()</code> are the same operation — they block the calling thread — and
  differ only in how they wrap exceptions. Advice to "use <code>GetAwaiter().GetResult()</code>
  instead of <code>.Result</code>" addresses the <code>AggregateException</code> wrapping from
  <a href="#/m/t2-04-task-and-valuetask">t2-04</a> and does nothing whatever about this.</p>

  <p><strong>FIX 1</strong> works because the continuation goes to the pool instead of the blocked
  context thread. It is the fix a <em>library</em> can apply unilaterally, without knowing anything
  about its callers.</p>

  <p><strong>FIX 2</strong> works because nothing is blocked. It is the real fix and the only one
  available to <em>application</em> code — but it requires changing the caller, which a library
  author cannot do.</p>

  <p><strong>FIX 3</strong> is not a fix anyone chooses. It is the reason this bug is invisible in
  ASP.NET Core and in every console-hosted test you will write. There is no context, so the
  continuation goes to the pool and the blocked thread is released.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>The wrong conclusion to draw from FIX 3.</strong> "ASP.NET Core has no context, so
    blocking is safe now" is the most common misreading of this whole topic. Blocking on a pool
    thread does not deadlock, but it still occupies a pool thread for the entire operation — which is
    the thread pool starvation measured in <a href="#/m/t2-02-thread-pool">t2-02</a>, where a
    blocking version of the same endpoint went from 110 ms to 2,917 ms under load.</p>
    <p>The same line of code produces a hang in a desktop app and a latency cliff in a web service.
    The rule that covers both is the same: <strong>do not block on async code.</strong>
    <code>ConfigureAwait(false)</code> exists to limit the damage when a caller does it anyway.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>Ledger.Payments 3.2.0, the shipped version. Every <code>await</code> in it looks like this, and
  it is what almost everybody writes:</p>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>/// &lt;summary&gt;
/// THE SHIPPED VERSION. A library method with a plain await. On a server this
/// behaves perfectly; in a UI host it deadlocks any caller that blocks.
/// &lt;/summary&gt;
public sealed class PaymentServiceV1
{
    private readonly PaymentGateway _gateway;
    public PaymentServiceV1(PaymentGateway gateway) =&gt; _gateway = gateway;

    public async Task&lt;Receipt&gt; PayAsync(Payment payment, CancellationToken ct = default)
    {
        var code = await _gateway.AuthoriseAsync(payment.Amount, ct);   // captures
        return new Receipt(payment.Reference, code);
    }
}

/// &lt;summary&gt;THE FIX. Identical, except that no await captures a context.&lt;/summary&gt;
public sealed class PaymentServiceV2
{
    private readonly PaymentGateway _gateway;
    public PaymentServiceV2(PaymentGateway gateway) =&gt; _gateway = gateway;

    public async Task&lt;Receipt&gt; PayAsync(Payment payment, CancellationToken ct = default)
    {
        var code = await _gateway.AuthoriseAsync(payment.Amount, ct).ConfigureAwait(false);
        return new Receipt(payment.Reference, code);
    }
}</code></pre>

  <p>Two hundred services on ASP.NET Core, nine months, no defects. Then the branch-operations team
  referenced it from a WPF till application:</p>

  <pre data-lang="console" data-title="03-production.cs"><code>  host                      library version         result       ms
  WPF (single-thread ctx)    3.2.0 (plain await)    DEADLOCKED  1,514
  WPF (single-thread ctx)    3.2.1 (ConfigureAwait) ok             62
  ASP.NET Core (no ctx)      3.2.0 (plain await)    ok             59</code></pre>

  <p><strong>Read rows one and three together.</strong> Identical library code, identical call site.
  One deadlocks and one does not, and the only difference is the host application. That is the reason
  the rule is stated as a rule about libraries rather than as a matter of correctness: <em>a library
  does not know where it will run</em>, and the failure appears only in an environment its authors
  may never use.</p>

  <p>The fix in 3.2.1 is a single method call per await, and nothing else changed:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong for a library: the shipped 3.2.0"><code>public async Task&lt;Receipt&gt; PayAsync(Payment payment, CancellationToken ct = default)
{
    var code = await _gateway.AuthoriseAsync(payment.Amount, ct);   // captures
    return new Receipt(payment.Reference, code);
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right for a library: 3.2.1"><code>public async Task&lt;Receipt&gt; PayAsync(Payment payment, CancellationToken ct = default)
{
    var code = await _gateway.AuthoriseAsync(payment.Amount, ct).ConfigureAwait(false);
    return new Receipt(payment.Reference, code);
}</code></pre>

  <h3>What it costs</h3>

  <p>The usual objection is that this clutters every line for a benefit most teams will never see.
  Measured in a host with no context, where it should be a no-op:</p>

  <pre data-lang="console" data-title="03-production.cs"><code>  variant                        bytes/call   ns/call
  plain await                             0        46
  ConfigureAwait(false)                   0        53</code></pre>

  <p>Effectively identical, which is the expected result — with no context to capture, the two paths
  do the same work. <strong>The cost of the rule is typing, not performance.</strong></p>

  <h3>What you actually lose</h3>

  <p>There is a real cost, and it is not the one people usually name. The common fear is that
  <code>ConfigureAwait(false)</code> will break structured logging, correlation ids or request
  culture, because those are "ambient" and the context is being discarded. That conflates two
  different mechanisms.</p>

  <p class="define"><span class="define__term">ExecutionContext</span> A separate ambient state
  container that flows across every <code>await</code>, carrying <code>AsyncLocal&lt;T&gt;</code>
  values — which is what logging scopes, <code>Activity</code> trace ids and
  <code>CultureInfo</code> are built on. <code>ConfigureAwait</code> has no effect on it whatsoever;
  suppressing its flow requires <code>ExecutionContext.SuppressFlow()</code>.</p>

  <pre data-lang="console" data-title="03-production.cs"><code>  before any await               : req-4f2a
  after ConfigureAwait(false)    : req-4f2a   (thread 8)
  after a plain await            : req-4f2a   (thread 8)</code></pre>

  <p>The correlation id survives both. Your logging does not break. <strong>What you lose is only the
  guarantee about which thread resumes you</strong>, which matters solely when a specific thread owns
  something — a UI control, or a thread-affine COM object. In a library that touches neither, you are
  giving up nothing you were using.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. <code>ConfigureAwait(false)</code> on the first await only</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: works until the cache is warm"><code>// WRONG. The reasoning sounds right — the first await is where you leave the
// context, so configure that one and the rest are already off it.
public async Task&lt;Receipt&gt; PayAsync(Payment payment, CancellationToken ct)
{
    var rate = await _rates.GetAsync(payment.Currency, ct).ConfigureAwait(false);
    var code = await _gateway.AuthoriseAsync(payment.Amount * rate, ct);   // plain
    return new Receipt(payment.Reference, code);
}</code></pre>

  <p>It holds only while the first await actually suspends. When the rate is cached, that await
  completes synchronously, never suspends, and therefore never leaves the context — so the second,
  plain <code>await</code> captures it and deadlocks. Measured:</p>

  <pre data-lang="console" data-title="04-exercises.cs"><code>  first await SUSPENDS, ConfigureAwait on it only    completed      74
  first await COMPLETES SYNCHRONOUSLY, same code     DEADLOCKED  1,507</code></pre>

  <p>Identical code, and whether it deadlocks depends on a cache hit. This is why the rule is
  <strong>every await in a library</strong>, not the first one: whether a given await suspends is not
  a property you can determine by reading the method.</p>

  <h3>2. Blocking, in any of its spellings</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: all four are the same mistake"><code>// WRONG. All four block the calling thread.
var receipt = PayAsync(payment).Result;
PayAsync(payment).Wait();
var receipt2 = PayAsync(payment).GetAwaiter().GetResult();
Task.Run(() =&gt; PayAsync(payment)).Result;     // the "clever" one; still blocks

// Right: async all the way up, including the entry point.
var receipt = await PayAsync(payment, ct);</code></pre>

  <p>The fourth deserves a note because it is often recommended.
  <code>Task.Run(() =&gt; ...).Result</code> does avoid the deadlock, because the lambda runs on a
  pool thread where there is no context to capture. It still blocks the calling thread, and it now
  burns a second thread as well. It converts a hang into starvation, which is a worse bug to
  diagnose, not a fix.</p>

  <h3>3. Putting <code>ConfigureAwait(false)</code> in application code that needs the context</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: in a WPF event handler"><code>// WRONG, in a UI application. The continuation resumes on a pool thread and
// touching the control throws InvalidOperationException.
private async void OnPayClicked(object sender, RoutedEventArgs e)
{
    var receipt = await _payments.PayAsync(_payment).ConfigureAwait(false);
    ResultLabel.Text = receipt.AuthCode;      // wrong thread
}

// Right: application code KEEPS the context, because it needs it.
private async void OnPayClicked(object sender, RoutedEventArgs e)
{
    var receipt = await _payments.PayAsync(_payment);
    ResultLabel.Text = receipt.AuthCode;      // back on the UI thread
}</code></pre>

  <p>The rule is not "always use <code>ConfigureAwait(false)</code>". It is
  <strong>libraries do, applications do not</strong>. A library has no idea what its caller needs and
  should not impose a thread requirement. An application is the thing that knows.</p>

  <h3>4. Assuming ASP.NET Core's lack of a context makes this a dead topic</h3>

  <p>It is dead for deadlocks in your own service, and alive everywhere else: any library you publish,
  any code shared with a desktop or Xamarin/MAUI front end, any .NET Framework service still in
  maintenance, and — most commonly — the fact that blocking still starves the pool. The failure moved;
  it did not go away.</p>

  <h3>5. Writing your own <code>SynchronizationContext</code> without a way out</h3>

  <p>The verification files for this module each implement one, and the first attempt hung
  permanently, because its "run this and wait" helper blocked the pump thread. If you build one, the
  helper that starts work on it must never block it — start the work, return a
  <code>Task</code>, and let the caller wait from outside.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a desktop application freezes permanently with zero CPU, no
    exception, and no log output.</p>
    <p><strong>Why:</strong> the UI thread is blocked inside <code>.Result</code> or
    <code>.Wait()</code> waiting for a continuation that can only run on the UI thread.</p>
    <p><strong>Tool:</strong> a dump, then the two commands that show both halves:</p>
    <pre data-lang="console" data-title="Confirming a context deadlock"><code>dotnet-dump collect --process-id 7188
dotnet-dump analyze core_20260831.dmp
&gt; clrstack -all           # find the UI thread blocked in a wait
&gt; dumpasync --stats       # find the state machine waiting to be resumed</code></pre>
    <p><strong>Reading it:</strong> the signature is both at once. One thread's stack shows your code
    calling <code>Task.Result</code> or <code>ManualResetEventSlim.Wait</code> below
    <code>Monitor.Wait</code>; and <code>dumpasync</code> shows a suspended state machine for a method
    that thread is waiting on. A blocked thread plus a suspended machine waiting for that same thread
    is a context deadlock and nothing else.</p>
    <p><strong>Fix:</strong> <code>await</code> instead of blocking at the call site;
    <code>ConfigureAwait(false)</code> throughout the library so the next caller who blocks does not
    hit it.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you need to know whether a context is even present, in a host you did
    not write.</p>
    <p><strong>Tool:</strong> print it. There is no subtler technique and it answers the question
    immediately:</p>
    <pre data-lang="csharp" data-net="10" data-title="Is there a context here?"><code>Console.WriteLine($"context   : {SynchronizationContext.Current?.GetType().FullName ?? "null"}");
Console.WriteLine($"scheduler : {TaskScheduler.Current.GetType().Name}");
Console.WriteLine($"thread    : {Environment.CurrentManagedThreadId}, " +
                  $"pool = {Thread.CurrentThread.IsThreadPoolThread}");</code></pre>
    <p><strong>Reading it:</strong> <code>null</code> plus <code>ThreadPoolTaskScheduler</code> means
    no capture happens and <code>ConfigureAwait(false)</code> is a no-op here. Anything else — a
    <code>DispatcherSynchronizationContext</code>, a <code>WindowsFormsSynchronizationContext</code>,
    an <code>AspNetSynchronizationContext</code>, or a test framework's own — means every plain
    <code>await</code> in the code below this point is capturing it.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a test suite hangs on one machine or one runner and passes on
    another.</p>
    <p><strong>Why:</strong> some test frameworks install a single-threaded context to make tests
    deterministic, and some do not. A library that blocks internally will deadlock under the first and
    pass under the second. The same applies to a single-threaded runner configuration.</p>
    <p><strong>Fix:</strong> test the library deliberately under a context rather than hoping. The
    single-threaded context in this module's verification files is about twenty lines and can go in a
    test helper; a test that runs your public API under it will catch this class of bug before a
    consumer does. This is the test that would have caught the Ledger incident nine months early.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> you want the rule enforced rather than remembered.</p>
    <p><strong>Tool:</strong> the analysers, plus a project-level default:</p>
    <pre data-lang="console" data-title="Enforcing the library rule"><code>dotnet add package Microsoft.VisualStudio.Threading.Analyzers

VSTHRD111  use ConfigureAwait(bool) on every await     (off by default; opt in for libraries)
VSTHRD002  avoid problematic synchronous waits          (.Result, .Wait())
VSTHRD103  call async methods when in an async method

CA2007     do not directly await a Task                 (the same rule, from the .NET analysers)</code></pre>
    <p><strong>Reading it:</strong> VSTHRD111 and CA2007 are deliberately off by default because they
    are wrong for application code. Turn them on in library projects only — that split is exactly the
    library/application distinction this module is about, expressed in the build.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A latent bug that nine months and two hundred services cannot find.</strong> Ledger's
    payment library ran several million transactions a day across ASP.NET Core hosts with no defect
    reports, because ASP.NET Core has no context and the bug is unreachable there. The first desktop
    consumer hit it on their first click. The cost was not the fix — one method call per await, a
    patch release — but the four days of investigation, during which the desktop rollout was blocked
    and the library team could not reproduce the fault on any machine they owned. Bugs that are
    invisible in your environment and deterministic in someone else's are the expensive kind, and
    this is the most common one in .NET.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>The same mistake costs differently depending on the host, and neither cost is
    zero.</strong> A single <code>.Result</code> on a UI thread is a permanent freeze. The same
    <code>.Result</code> in an ASP.NET Core handler at 400 requests per second holds one pool thread
    per in-flight request; <a href="#/m/t2-02-thread-pool">t2-02</a> measured that shape going from
    110 ms to 2,917 ms — a 29-fold latency increase — because the pool injects new threads at roughly
    one per 500 ms. Teams who learn "the deadlock does not happen in ASP.NET Core" and conclude that
    blocking is now acceptable have swapped a loud failure for a quiet one.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Deadlock risk that depends on a cache hit rate.</strong> The measurement in this module
    shows a method with <code>ConfigureAwait(false)</code> on its first await deadlocking only when
    that await completes synchronously. In a real service the rate cache is warm most of the time,
    which means the partially-fixed library works in development, works in testing, works under load,
    and fails on the requests where the cache happened to be warm — an intermittent, load-dependent
    deadlock with no pattern a bug report can capture. The all-or-nothing rule is not pedantry; it is
    the only version of the rule that can be reasoned about locally.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Always use <code>ConfigureAwait(false)</code>."</strong> Libraries should; applications
    should not. Application code is what knows whether it needs a particular thread, and a WPF handler
    that discards the context throws the moment it touches a control. The real rule has two halves and
    the second half is usually dropped.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>ConfigureAwait(false)</code> makes the code run on a background
    thread."</strong> It does not start anything or move anything. It says only "when this resumes, do
    not bother restoring the context". If the awaited operation completes synchronously, nothing
    suspends and you never leave the thread you were on.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"It costs performance, so only add it where it matters."</strong> Measured at 0 bytes
    and within noise on time. There is no per-call price to weigh against the risk.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"It breaks my logging scopes and correlation ids."</strong> It does not.
    <code>AsyncLocal&lt;T&gt;</code> rides on <code>ExecutionContext</code>, which flows across every
    await regardless — verified: the correlation id was intact after
    <code>ConfigureAwait(false)</code>. <code>ConfigureAwait</code> controls
    <code>SynchronizationContext</code> only, and they are different mechanisms.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>GetAwaiter().GetResult()</code> is the safe way to block."</strong> It is
    identical in blocking behaviour to <code>.Result</code> and <code>.Wait()</code> — all three
    deadlocked in the same measurement. It differs only in unwrapping
    <code>AggregateException</code>, which is a nicer error message for a bug you still have.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>Task.Run(() =&gt; FooAsync()).Result</code> is a valid workaround."</strong> It
    avoids the deadlock and keeps the blocking, now across two threads. In a server it doubles the
    starvation; in a UI app it freezes the interface without deadlocking, which is only marginally
    better. It is a way of not fixing the problem.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"ASP.NET Core removed the context, so this is legacy trivia."</strong> It removed the
    deadlock from server code. It did not remove it from libraries consumed by UI hosts, from .NET
    Framework services still in maintenance, or from test frameworks that install their own context —
    and it did nothing about the starvation that blocking causes regardless.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <p>Every answer below is produced by running <code>04-exercises.cs</code>, included in full at the
  end. Predict before revealing; exercise 2 in particular has an answer most people get wrong.</p>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>In a host with a single-threaded context, name the thread each of these resumes on.</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>await Task.Delay(10).ConfigureAwait(true);    // (a)
await Task.Delay(10).ConfigureAwait(false);   // (b)
await Task.Delay(10).ConfigureAwait(true);    // (c)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    context thread is          : 4
    after plain await          : 4  (context)
    after ConfigureAwait(false): 6  (pool)
    after a LATER plain await  : 6  (still pool)</code></pre>
        <p>(a) resumes on the context thread — that is what capture does. (b) resumes on a pool
        thread. <strong>(c) also resumes on a pool thread</strong>, which is the part that surprises
        people.</p>
        <p><code>ConfigureAwait(false)</code> is not a setting that applies to one await and then
        reverts. It moves you off the context, and once you are on a pool thread
        <code>SynchronizationContext.Current</code> is <code>null</code> — so a later plain
        <code>await</code> has nothing to capture. There is no automatic route back; returning to the
        context requires posting to it explicitly.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Given exercise 1, here is a tempting optimisation: since <code>ConfigureAwait(false)</code>
    moves you off the context permanently, put it on the first await only and leave the rest plain.
    Is that safe? If not, when exactly does it fail?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>static async Task FirstSuspends()
{
    await Task.Delay(30).ConfigureAwait(false);      // suspends
    await Task.Delay(30);                            // plain
}

static async Task FirstCompletesSync()
{
    await Task.CompletedTask.ConfigureAwait(false);  // does NOT suspend
    await Task.Delay(30);                            // plain
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  first await SUSPENDS, ConfigureAwait on it only    completed      74
  first await COMPLETES SYNCHRONOUSLY, same code     DEADLOCKED  1,507</code></pre>
        <p><strong>It is not safe.</strong> <code>ConfigureAwait(false)</code> only moves you off the
        context <em>if the await actually suspends</em>. When the awaited operation is already
        complete, the state machine falls straight through it — as measured in
        <a href="#/m/t2-05-async-state-machine">t2-05</a>, a non-suspending await costs no
        continuation and no thread change — so you are still on the context thread. The second, plain
        <code>await</code> then captures it and deadlocks.</p>
        <p><strong>Why this matters more than it looks.</strong> Whether the first await suspends is
        usually a property of runtime data, not of the code: a cache hit, a buffer that already held
        the bytes, a connection already open. So the partially-fixed library works in development and
        under test, and deadlocks intermittently in production on exactly the requests where the cache
        was warm — which is a bug report nobody can write usefully.</p>
        <p>This is the argument for the rule being <strong>every await</strong> rather than a judgment
        call per call site. The all-or-nothing version is the only one you can verify by reading a
        method.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Which of these deadlock, and for the ones that do not, is the code therefore fine?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>// (a) on a single-threaded context
Capturing().GetAwaiter().GetResult();

// (b) on a single-threaded context
NonCapturing().GetAwaiter().GetResult();

// (c) on a thread pool thread
Capturing().GetAwaiter().GetResult();

static async Task Capturing()    =&gt; await Task.Delay(30);
static async Task NonCapturing() =&gt; await Task.Delay(30).ConfigureAwait(false);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  (a) UI context, .Result on a capturing method      DEADLOCKED  1,509
  (b) UI context, .Result, ConfigureAwait(false)     completed      47
  (c) pool thread, .Result on capturing method       completed      38</code></pre>
        <p><strong>(a) deadlocks.</strong> One thread, blocked, waiting for a continuation only it can
        run.</p>
        <p><strong>(b) completes</strong>, because the continuation goes to the pool rather than to
        the blocked thread.</p>
        <p><strong>(c) completes</strong> — and is <em>not</em> fine, which is the real question here.
        There is no context on a pool thread, so nothing deadlocks, but the blocking call occupies a
        pool thread for the whole 30 ms operation. At scale that is thread pool starvation
        (<a href="#/m/t2-02-thread-pool">t2-02</a>), and it is a harder failure to attribute than a
        deadlock because it presents as general slowness rather than as a hang.</p>
        <p>The lesson: "it did not deadlock" is not the same as "it is correct". Only (b) is safe
        <em>from the library's side</em>, and even then the caller should not have blocked.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Your service sets a correlation id in an <code>AsyncLocal&lt;string&gt;</code> at the start of
    each request and your logger reads it. A colleague objects to adding
    <code>ConfigureAwait(false)</code> on the grounds that discarding the context will lose it. Are
    they right?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  on the context thread (14)
  before await                : AsyncLocal=invoice-8821, ctx=SingleThreadContext
  after ConfigureAwait(false) : AsyncLocal=invoice-8821, ctx=null</code></pre>
        <p><strong>No.</strong> The context was dropped and the <code>AsyncLocal</code> survived, in
        the same await. They are two separate mechanisms that people conflate constantly.</p>
        <p><code>SynchronizationContext</code> answers "which thread should resume me".
        <code>ExecutionContext</code> carries ambient state — <code>AsyncLocal&lt;T&gt;</code> values,
        and therefore <code>ILogger</code> scopes, <code>Activity</code>/trace ids and
        <code>CultureInfo</code> — and it flows across every await unconditionally.
        <code>ConfigureAwait</code> controls only the first.</p>
        <p>You cannot even opt out of <code>ExecutionContext</code> flow with
        <code>ConfigureAwait</code>; that requires <code>ExecutionContext.SuppressFlow()</code>, which
        is a deliberate and rarely correct thing to do.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>What does <code>ConfigureAwait(true)</code> do that a plain <code>await</code> does not, and is
    there ever a reason to write it?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  variant                     bytes/call   ns/call
  plain await                          0        65
  ConfigureAwait(true)                 0        50
  ConfigureAwait(false)                0        50</code></pre>
        <p><strong>Nothing.</strong> <code>true</code> is the default, so
        <code>ConfigureAwait(true)</code> and a plain <code>await</code> are the same operation, and
        all three are indistinguishable in cost. (The spread across those three numbers is measurement
        noise, not a real difference — do not read the 65 as a cost of the plain form.)</p>
        <p>Its one genuine use is as documentation. In a UI codebase where most awaits deliberately
        keep the context, writing <code>ConfigureAwait(true)</code> at the few places where that
        matters says "I thought about this and I need to come back to this thread" — which a reviewer
        cannot otherwise distinguish from an await where nobody considered the question. Some teams
        adopt it so that a plain <code>await</code> becomes a review flag.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write the test that would have caught the Ledger incident before release. You have the public
    API and no ability to change the caller.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>Run the library's public surface under a single-threaded context, from a caller that
        blocks — which is precisely what the failing consumer did. The context implementation is
        about twenty lines and belongs in a shared test helper:</p>
        <pre data-lang="csharp" data-net="10" data-title="The test that catches it"><code>[Fact]
public void PayAsync_DoesNotDeadlock_UnderASingleThreadedContext()
{
    using var ctx = new OneThreadContext();
    var completed = new ManualResetEventSlim(false);

    ctx.Post(_ =&gt;
    {
        // Deliberately the WRONG way to call it — that is the point.
        var receipt = new PaymentService(new PaymentGateway())
            .PayAsync(new Payment("PAY-1", 42m))
            .GetAwaiter().GetResult();
        completed.Set();
    }, null);

    Assert.True(completed.Wait(TimeSpan.FromSeconds(2)),
        "PayAsync deadlocked under a SynchronizationContext: an await is capturing it. " +
        "Every await in a library must use ConfigureAwait(false).");
}</code></pre>
        <p>Three things make this a good test rather than a curiosity.</p>
        <p><strong>It tests the contract a library actually has</strong>, which includes "does not
        impose a thread requirement on the caller" — a property no functional test covers.</p>
        <p><strong>It calls the API the wrong way on purpose.</strong> Blocking is a caller mistake,
        but a published library will meet callers who make it, and the failure mode should be a slow
        call rather than a permanent hang.</p>
        <p><strong>The assertion message names the cause.</strong> A bare timeout failure sends the
        next engineer looking at the gateway; this one points at the actual rule.</p>
        <p>An alternative worth knowing is
        <code>Microsoft.VisualStudio.Threading</code>'s <code>JoinableTaskFactory</code>, which solves
        the same problem for application code that genuinely must block on a UI thread by letting the
        blocked thread pump continuations while it waits. It is the right tool for legacy UI
        codebases; it is not a substitute for the library rule.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 02-the-deadlock.cs -c Release</code>. Each terminates on its
  own — the deadlocking cases are bounded by a timeout so the program can report and continue.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-the-deadlock.cs"><code>// 02-the-deadlock.cs — the classic sync-over-async deadlock, reproduced
// deliberately, with a timeout so this file always terminates. Then the three
// things that each fix it, and the one that does not.
//
// Every "deadlocked" result below is a real deadlock: the work never completes.
// The timeout is only so the program can report it and move on.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-the-deadlock.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int TimeoutMs = 1500;

    static void Main()
    {
        Console.WriteLine("=== the deadlock, in three lines ===");
        Console.WriteLine();
        Console.WriteLine("  A context with ONE thread. On that thread, someone calls .Result on");
        Console.WriteLine("  a method that awaits without ConfigureAwait(false).");
        Console.WriteLine();
        Console.WriteLine("    1. the await captures the context and suspends");
        Console.WriteLine("    2. the operation finishes and Posts the continuation to the context");
        Console.WriteLine("    3. the context's one thread is blocked inside .Result, waiting for");
        Console.WriteLine("       the continuation it is preventing from running");
        Console.WriteLine();
        Console.WriteLine("  Neither side can move. This is not a slow operation or a race; it is");
        Console.WriteLine("  permanent, and it survives any timeout you put on the HTTP call.");

        Console.WriteLine();
        Console.WriteLine("=== measured ===");
        Console.WriteLine();
        Console.WriteLine("  scenario                                        result       ms");

        Run("UI context, .Result, plain await", (ctx, done) =&gt; ctx.Post(_ =&gt;
        {
            var _unused = CapturingAsync(done).Result;
        }, null));

        Run("UI context, .Wait(), plain await", (ctx, done) =&gt; ctx.Post(_ =&gt;
        {
            CapturingAsync(done).Wait();
        }, null));

        Run("UI context, GetAwaiter().GetResult()", (ctx, done) =&gt; ctx.Post(_ =&gt;
        {
            var _unused = CapturingAsync(done).GetAwaiter().GetResult();
        }, null));

        Console.WriteLine();
        Console.WriteLine("  All three block. They are the same operation with different spelling:");
        Console.WriteLine("  .Result, .Wait() and GetAwaiter().GetResult() all block the calling");
        Console.WriteLine("  thread. Only the exception wrapping differs.");

        Console.WriteLine();
        Console.WriteLine("=== what fixes it ===");
        Console.WriteLine();
        Console.WriteLine("  scenario                                        result       ms");

        Run("FIX 1: ConfigureAwait(false) in the library", (ctx, done) =&gt; ctx.Post(_ =&gt;
        {
            var _unused = NonCapturingAsync(done).Result;
        }, null));

        Run("FIX 2: await instead of blocking", (ctx, done) =&gt; ctx.Post(async void (_) =&gt;
        {
            var _unused = await CapturingAsync(done).ConfigureAwait(true);
        }, null));

        Run("FIX 3: no context to capture", (_, done) =&gt;
        {
            ThreadPool.QueueUserWorkItem(_ =&gt;
            {
                var _unused = CapturingAsync(done).Result;
            });
        }, useContext: false);

        Console.WriteLine();
        Console.WriteLine("  FIX 1 works because the continuation goes to the pool instead of");
        Console.WriteLine("  the blocked context thread. It is what a LIBRARY can do unilaterally.");
        Console.WriteLine("  FIX 2 works because nothing is blocked. It is the real fix, and the");
        Console.WriteLine("  only one available to APPLICATION code.");
        Console.WriteLine("  FIX 3 is not a fix you choose — it is why this bug is invisible in");
        Console.WriteLine("  ASP.NET Core and a console app. There is no context, so the");
        Console.WriteLine("  continuation goes to the pool and the blocked thread is released.");

        Console.WriteLine();
        Console.WriteLine("=== the trap in FIX 3 ===");
        Console.WriteLine();
        Console.WriteLine("  'No context, so blocking is safe' is the wrong conclusion. Blocking");
        Console.WriteLine("  on a pool thread does not deadlock, but it still OCCUPIES a pool");
        Console.WriteLine("  thread for the whole operation, which is thread pool starvation —");
        Console.WriteLine("  measured in t2-02. Same code, two different failures depending on");
        Console.WriteLine("  the host: a hang in a UI app, a latency cliff in a web service.");
        Console.WriteLine();
        Console.WriteLine("  The rule that covers both: do not block on async code. The reason");
        Console.WriteLine("  ConfigureAwait(false) exists is to protect a LIBRARY from callers");
        Console.WriteLine("  who do it anyway.");
    }

    static void Run(string label, Action&lt;SingleThreadContext, ManualResetEventSlim&gt; start,
                    bool useContext = true)
    {
        // A FRESH signal per scenario. An earlier version shared one static
        // event and a late continuation from a previous row set it, which made
        // a 50 ms operation report 1 ms.
        var done = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        SingleThreadContext? ctx = null;
        try
        {
            if (useContext)
            {
                ctx = new SingleThreadContext();
                ctx.Post(_ =&gt; { }, null);          // prove the pump is alive
            }
            start(ctx!, done);

            // Done() is called at the END of the awaited work, after the
            // continuation runs. In a deadlock that continuation never runs, so
            // this times out and the row reports DEADLOCKED.
            var completed = done.Wait(TimeoutMs);

            sw.Stop();
            Console.WriteLine($"  {label,-46} {(completed ? "completed" : "DEADLOCKED"),-11} " +
                              $"{sw.Elapsed.TotalMilliseconds,5:N0}");
        }
        finally
        {
            ctx?.Abandon();
        }
    }

    /// &lt;summary&gt;Captures the context at its await. The dangerous shape for a library.&lt;/summary&gt;
    static async Task&lt;int&gt; CapturingAsync(ManualResetEventSlim done)
    {
        await Task.Delay(50);                      // no ConfigureAwait: captures
        done.Set();
        return 1;
    }

    /// &lt;summary&gt;Does not capture. The shape a library should ship.&lt;/summary&gt;
    static async Task&lt;int&gt; NonCapturingAsync(ManualResetEventSlim done)
    {
        await Task.Delay(50).ConfigureAwait(false);
        done.Set();
        return 1;
    }
}

/// &lt;summary&gt;A single-threaded SynchronizationContext, as a UI framework provides.&lt;/summary&gt;
sealed class SingleThreadContext : SynchronizationContext
{
    private readonly BlockingCollection&lt;(SendOrPostCallback, object?)&gt; _queue = new();
    private readonly Thread _thread;
    private int _pending;

    public SingleThreadContext()
    {
        _thread = new Thread(Pump) { IsBackground = true, Name = "UI" };
        _thread.Start();
    }

    private void Pump()
    {
        SetSynchronizationContext(this);
        foreach (var (callback, state) in _queue.GetConsumingEnumerable())
        {
            try { callback(state); }
            catch { /* a deadlocked callback never returns; nothing to catch */ }
            finally { Interlocked.Decrement(ref _pending); }
        }
    }

    public override void Post(SendOrPostCallback d, object? state)
    {
        Interlocked.Increment(ref _pending);
        _queue.Add((d, state));
    }

    /// &lt;summary&gt;Walk away from the thread; it is background, so it dies with the process.&lt;/summary&gt;
    public void Abandon() =&gt; _queue.CompleteAdding();
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — Ledger.Payments, a library shipped without
// ConfigureAwait(false), and what happened when a desktop team consumed it.
// Then the two things people get wrong about the fix: what it costs, and what
// it does to the ambient state your logging depends on.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Payments;

public sealed record Payment(string Reference, decimal Amount);
public sealed record Receipt(string Reference, string AuthCode);

/// &lt;summary&gt;Stands in for the remote card gateway.&lt;/summary&gt;
public sealed class PaymentGateway
{
    public async Task&lt;string&gt; AuthoriseAsync(decimal amount, CancellationToken ct = default)
    {
        await Task.Delay(50, ct).ConfigureAwait(false);
        return $"AUTH-{amount:0}";
    }
}

/// &lt;summary&gt;
/// THE SHIPPED VERSION. A library method with a plain await. On a server this
/// behaves perfectly; in a UI host it deadlocks any caller that blocks.
/// &lt;/summary&gt;
public sealed class PaymentServiceV1
{
    private readonly PaymentGateway _gateway;
    public PaymentServiceV1(PaymentGateway gateway) =&gt; _gateway = gateway;

    public async Task&lt;Receipt&gt; PayAsync(Payment payment, CancellationToken ct = default)
    {
        var code = await _gateway.AuthoriseAsync(payment.Amount, ct);   // captures
        return new Receipt(payment.Reference, code);
    }
}

/// &lt;summary&gt;THE FIX. Identical, except that no await captures a context.&lt;/summary&gt;
public sealed class PaymentServiceV2
{
    private readonly PaymentGateway _gateway;
    public PaymentServiceV2(PaymentGateway gateway) =&gt; _gateway = gateway;

    public async Task&lt;Receipt&gt; PayAsync(Payment payment, CancellationToken ct = default)
    {
        var code = await _gateway.AuthoriseAsync(payment.Amount, ct).ConfigureAwait(false);
        return new Receipt(payment.Reference, code);
    }
}

class Program
{
    const int TimeoutMs = 1500;
    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger.Payments 3.2.0 shipped in March. Two hundred services use it");
        Console.WriteLine("  on ASP.NET Core with no reported problems in nine months.");
        Console.WriteLine("  In December the branch-operations team referenced the same package");
        Console.WriteLine("  from their WPF desktop till application. Clicking 'Take payment'");
        Console.WriteLine("  froze the window permanently. No exception, no log line, no CPU.");
        Console.WriteLine();
        Console.WriteLine("  Their call site, which is the ordinary shape for a click handler:");
        Console.WriteLine("      var receipt = _payments.PayAsync(payment).Result;");
        Console.WriteLine();

        var payment = new Payment("PAY-0001", 42.00m);
        Console.WriteLine("  host                      library version         result       ms");

        Measure("WPF (single-thread ctx)", "3.2.0 (plain await)", useContext: true,
            (done, ct) =&gt; new PaymentServiceV1(new PaymentGateway()).PayAsync(payment, ct));

        Measure("WPF (single-thread ctx)", "3.2.1 (ConfigureAwait)", useContext: true,
            (done, ct) =&gt; new PaymentServiceV2(new PaymentGateway()).PayAsync(payment, ct));

        Measure("ASP.NET Core (no ctx)", "3.2.0 (plain await)", useContext: false,
            (done, ct) =&gt; new PaymentServiceV1(new PaymentGateway()).PayAsync(payment, ct));

        Console.WriteLine();
        Console.WriteLine("  The library was never tested in a host that has a context, because");
        Console.WriteLine("  nobody who wrote it had ever used one. The bug was present from the");
        Console.WriteLine("  first release and undetectable for nine months.");
        Console.WriteLine();
        Console.WriteLine("  Read the first and third rows together. The SAME library code");
        Console.WriteLine("  deadlocks or does not depending entirely on the host application.");
        Console.WriteLine("  This is why the rule is about libraries, not about correctness:");
        Console.WriteLine("  a library does not know where it will run.");

        Console.WriteLine();
        Console.WriteLine("=== what ConfigureAwait(false) costs ===");
        Console.WriteLine();
        Console.WriteLine("  A common objection is that it clutters code for a theoretical gain.");
        Console.WriteLine("  Measured in a host with NO context, where it should be a no-op:");
        Console.WriteLine();
        Console.WriteLine("  variant                        bytes/call   ns/call");
        Console.WriteLine($"  plain await                    {Alloc(() =&gt; _sink += Plain().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() =&gt; _sink += Plain().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine($"  ConfigureAwait(false)          {Alloc(() =&gt; _sink += Configured().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() =&gt; _sink += Configured().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine();
        Console.WriteLine("  Effectively identical, which is the expected result: with no context");
        Console.WriteLine("  to capture, the two paths do the same work. The cost of the rule is");
        Console.WriteLine("  typing, not performance.");

        Console.WriteLine();
        Console.WriteLine("=== the real cost: what you lose ===");
        Console.WriteLine();
        Console.WriteLine("  ConfigureAwait(false) abandons the SynchronizationContext. It does");
        Console.WriteLine("  NOT abandon ExecutionContext, which is what carries AsyncLocal&lt;T&gt; —");
        Console.WriteLine("  and AsyncLocal is what logging scopes, Activity/trace ids and");
        Console.WriteLine("  CultureInfo are built on. People conflate the two constantly.");
        Console.WriteLine();
        AsyncLocalSurvives().GetAwaiter().GetResult();

        Console.WriteLine();
        Console.WriteLine("  So a correlation id set before the await is still readable after it,");
        Console.WriteLine("  with or without ConfigureAwait(false). Your structured logging does");
        Console.WriteLine("  not break. What you lose is only the guarantee about WHICH THREAD");
        Console.WriteLine("  resumes you, which matters solely when a specific thread owns");
        Console.WriteLine("  something — a UI control, or a thread-affine COM object.");
    }

    static readonly AsyncLocal&lt;string&gt; Correlation = new();

    static async Task AsyncLocalSurvives()
    {
        Correlation.Value = "req-4f2a";
        Console.WriteLine($"  before any await               : {Correlation.Value}");

        await Task.Delay(10).ConfigureAwait(false);
        Console.WriteLine($"  after ConfigureAwait(false)    : {Correlation.Value}   " +
                          $"(thread {Environment.CurrentManagedThreadId})");

        await Task.Delay(10).ConfigureAwait(true);
        Console.WriteLine($"  after a plain await            : {Correlation.Value}   " +
                          $"(thread {Environment.CurrentManagedThreadId})");
    }

    static async Task&lt;int&gt; Plain()
    {
        await Task.CompletedTask;
        return 1;
    }

    static async Task&lt;int&gt; Configured()
    {
        await Task.CompletedTask.ConfigureAwait(false);
        return 1;
    }

    static void Measure(string host, string version, bool useContext,
                        Func&lt;ManualResetEventSlim, CancellationToken, Task&lt;Receipt&gt;&gt; call)
    {
        var done = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        SingleThreadContext? ctx = null;

        try
        {
            if (useContext)
            {
                ctx = new SingleThreadContext();
                ctx.Post(_ =&gt;
                {
                    // The WPF click handler: blocking on the library's Task.
                    var receipt = call(done, CancellationToken.None).Result;
                    _sink += receipt.AuthCode.Length;
                    done.Set();
                }, null);
            }
            else
            {
                ThreadPool.QueueUserWorkItem(_ =&gt;
                {
                    var receipt = call(done, CancellationToken.None).Result;
                    _sink += receipt.AuthCode.Length;
                    done.Set();
                });
            }

            var completed = done.Wait(TimeoutMs);
            sw.Stop();
            Console.WriteLine($"  {host,-26} {version,-22} {(completed ? "ok" : "DEADLOCKED"),-11} " +
                              $"{sw.Elapsed.TotalMilliseconds,5:N0}");
        }
        finally
        {
            ctx?.Abandon();
        }
    }

    static long Alloc(Action a, int reps = 100_000)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i &lt; reps; i++) a();
        return (GC.GetAllocatedBytesForCurrentThread() - before) / reps;
    }

    static double Nanos(Action a, int reps = 100_000)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; reps; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / reps;
    }
}

/// &lt;summary&gt;A single-threaded SynchronizationContext, as WPF and WinForms provide.&lt;/summary&gt;
sealed class SingleThreadContext : SynchronizationContext
{
    private readonly BlockingCollection&lt;(SendOrPostCallback, object?)&gt; _queue = new();

    public SingleThreadContext()
    {
        var thread = new Thread(Pump) { IsBackground = true, Name = "UI" };
        thread.Start();
    }

    private void Pump()
    {
        SetSynchronizationContext(this);
        foreach (var (callback, state) in _queue.GetConsumingEnumerable())
            callback(state);
    }

    public override void Post(SendOrPostCallback d, object? state) =&gt; _queue.Add((d, state));

    public void Abandon() =&gt; _queue.CompleteAdding();
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs"><code>// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int TimeoutMs = 1500;
    static long _sink;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: where does each await resume? =====");
        Console.WriteLine();
        Console.WriteLine("  Predict the thread for each, in a host WITH a single-threaded context.");
        Console.WriteLine();
        WithContext(async ctxThread =&gt;
        {
            Console.WriteLine($"    context thread is          : {ctxThread}");
            await Task.Delay(10).ConfigureAwait(true);
            Console.WriteLine($"    after plain await          : {Environment.CurrentManagedThreadId}  (context)");
            await Task.Delay(10).ConfigureAwait(false);
            Console.WriteLine($"    after ConfigureAwait(false): {Environment.CurrentManagedThreadId}  (pool)");
            await Task.Delay(10).ConfigureAwait(true);
            Console.WriteLine($"    after a LATER plain await  : {Environment.CurrentManagedThreadId}  (still pool)");
        });
        Console.WriteLine();
        Console.WriteLine("  The last line is the one people get wrong. ConfigureAwait(false) does");
        Console.WriteLine("  not apply to one await — it moves you OFF the context, and a later");
        Console.WriteLine("  plain await has nothing left to capture. There is no way back except");
        Console.WriteLine("  posting to the context explicitly.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: is ConfigureAwait(false) on the first await enough? =====");
        Console.WriteLine();
        Console.WriteLine("  A tempting optimisation: put it on the first await only, since that");
        Console.WriteLine("  is where you leave the context. When does that fail?");
        Console.WriteLine();
        Console.WriteLine("  scenario                                            result       ms");
        Deadlock("first await SUSPENDS, ConfigureAwait on it only", FirstSuspends);
        Deadlock("first await COMPLETES SYNCHRONOUSLY, same code", FirstCompletesSync);
        Console.WriteLine();
        Console.WriteLine("  It is not enough. If the first await completes synchronously it never");
        Console.WriteLine("  suspends, so it never leaves the context — and the SECOND await, the");
        Console.WriteLine("  plain one, captures and deadlocks.");
        Console.WriteLine("  Whether your first await suspends depends on a cache, a buffer, or");
        Console.WriteLine("  the network. That is not a property you can reason about locally,");
        Console.WriteLine("  which is why the rule is EVERY await in a library, not the first.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which of these deadlock? =====");
        Console.WriteLine();
        Console.WriteLine("  scenario                                            result       ms");
        Deadlock("(a) UI context, .Result on a capturing method", ct =&gt; Capturing());
        Deadlock("(b) UI context, .Result, ConfigureAwait(false)", ct =&gt; NonCapturing());
        DeadlockOnPool("(c) pool thread, .Result on capturing method", Capturing);
        Console.WriteLine();
        Console.WriteLine("  (a) deadlocks: one thread, blocked, waiting for itself.");
        Console.WriteLine("  (b) does not: the continuation goes to the pool.");
        Console.WriteLine("  (c) does not DEADLOCK, but it burns a pool thread for the whole");
        Console.WriteLine("      operation. That is starvation rather than a hang — a slower");
        Console.WriteLine("      failure, and a harder one to attribute.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: does ConfigureAwait(false) break your logging? =====");
        Console.WriteLine();
        WithContext(AmbientState);
        Console.WriteLine();
        Console.WriteLine("  No. SynchronizationContext and ExecutionContext are different things.");
        Console.WriteLine("  ConfigureAwait(false) opts out of the FORMER only. AsyncLocal&lt;T&gt; —");
        Console.WriteLine("  and therefore logging scopes, trace ids and CultureInfo — rides on");
        Console.WriteLine("  the latter and flows across every await regardless.");
        Console.WriteLine("  You cannot opt out of ExecutionContext flow with ConfigureAwait at");
        Console.WriteLine("  all; that needs ExecutionContext.SuppressFlow().");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: what does ConfigureAwait(true) do? =====");
        Console.WriteLine();
        Console.WriteLine("  It is the DEFAULT, so it does nothing a plain await does not do.");
        Console.WriteLine("  Measured with no context, so both should be identical:");
        Console.WriteLine();
        Console.WriteLine("  variant                     bytes/call   ns/call");
        Console.WriteLine($"  plain await                 {Alloc(() =&gt; _sink += Plain().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() =&gt; _sink += Plain().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine($"  ConfigureAwait(true)        {Alloc(() =&gt; _sink += True().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() =&gt; _sink += True().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine($"  ConfigureAwait(false)       {Alloc(() =&gt; _sink += False().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() =&gt; _sink += False().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine();
        Console.WriteLine("  Its only real use is documentation: writing ConfigureAwait(true) says");
        Console.WriteLine("  'I thought about this and I need the context', which is worth saying");
        Console.WriteLine("  in a UI codebase where the reviewer cannot otherwise tell the");
        Console.WriteLine("  deliberate cases from the forgotten ones.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // --- Exercise 2 -----------------------------------------------------------
    static async Task FirstSuspends()
    {
        await Task.Delay(30).ConfigureAwait(false);   // suspends -&gt; leaves the context
        await Task.Delay(30);                         // plain, but context already gone
    }

    static async Task FirstCompletesSync()
    {
        await Task.CompletedTask.ConfigureAwait(false);  // does NOT suspend -&gt; still on context
        await Task.Delay(30);                            // plain -&gt; captures -&gt; deadlock
    }

    // --- Exercise 3 -----------------------------------------------------------
    static async Task Capturing() =&gt; await Task.Delay(30);
    static async Task NonCapturing() =&gt; await Task.Delay(30).ConfigureAwait(false);

    // --- Exercise 4 -----------------------------------------------------------
    static readonly AsyncLocal&lt;string&gt; Scope = new();

    static async Task AmbientState(int contextThread)
    {
        Scope.Value = "invoice-8821";
        Console.WriteLine($"  on the context thread ({contextThread})");
        Console.WriteLine($"  before await                : AsyncLocal={Scope.Value}, " +
                          $"ctx={SynchronizationContext.Current?.ToString() ?? "null"}");

        await Task.Delay(10).ConfigureAwait(false);
        Console.WriteLine($"  after ConfigureAwait(false) : AsyncLocal={Scope.Value}, " +
                          $"ctx={SynchronizationContext.Current?.ToString() ?? "null"}");
        Console.WriteLine($"  The AsyncLocal SURVIVED and the context was DROPPED. Two different");
        Console.WriteLine($"  mechanisms, and only one of them is what ConfigureAwait controls.");
    }

    // --- Exercise 5 -----------------------------------------------------------
    static async Task&lt;int&gt; Plain() { await Task.CompletedTask; return 1; }
    static async Task&lt;int&gt; True() { await Task.CompletedTask.ConfigureAwait(true); return 1; }
    static async Task&lt;int&gt; False() { await Task.CompletedTask.ConfigureAwait(false); return 1; }

    // --- harness --------------------------------------------------------------
    static void WithContext(Func&lt;int, Task&gt; work)
    {
        using var ctx = new SingleThreadContext();
        ctx.RunAsync(work).Wait(TimeoutMs);
    }

    static void Deadlock(string label, Func&lt;CancellationToken, Task&gt; work)
    {
        var done = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        var ctx = new SingleThreadContext();
        try
        {
            ctx.Post(_ =&gt;
            {
                work(CancellationToken.None).GetAwaiter().GetResult();
                done.Set();
            }, null);
            Report(label, done.Wait(TimeoutMs), sw);
        }
        finally { ctx.Abandon(); }
    }

    static void Deadlock(string label, Func&lt;Task&gt; work) =&gt; Deadlock(label, _ =&gt; work());

    static void DeadlockOnPool(string label, Func&lt;Task&gt; work)
    {
        var done = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        ThreadPool.QueueUserWorkItem(_ =&gt;
        {
            work().GetAwaiter().GetResult();
            done.Set();
        });
        Report(label, done.Wait(TimeoutMs), sw);
    }

    static void Report(string label, bool completed, Stopwatch sw)
    {
        sw.Stop();
        Console.WriteLine($"  {label,-50} {(completed ? "completed" : "DEADLOCKED"),-11} " +
                          $"{sw.Elapsed.TotalMilliseconds,5:N0}");
    }

    static long Alloc(Action a, int reps = 100_000)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i &lt; reps; i++) a();
        return (GC.GetAllocatedBytesForCurrentThread() - before) / reps;
    }

    static double Nanos(Action a, int reps = 100_000)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; reps; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / reps;
    }
}

/// &lt;summary&gt;A single-threaded SynchronizationContext, as WPF and WinForms provide.&lt;/summary&gt;
sealed class SingleThreadContext : SynchronizationContext, IDisposable
{
    private readonly BlockingCollection&lt;(SendOrPostCallback, object?)&gt; _queue = new();
    private readonly Thread _thread;

    public SingleThreadContext()
    {
        _thread = new Thread(Pump) { IsBackground = true, Name = "UI" };
        _thread.Start();
    }

    private void Pump()
    {
        SetSynchronizationContext(this);
        foreach (var (callback, state) in _queue.GetConsumingEnumerable())
            callback(state);
    }

    public override void Post(SendOrPostCallback d, object? state) =&gt; _queue.Add((d, state));

    /// &lt;summary&gt;Runs async work ON the context thread without ever blocking it.&lt;/summary&gt;
    public Task RunAsync(Func&lt;int, Task&gt; work)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Post(async void (_) =&gt;
        {
            try
            {
                await work(Environment.CurrentManagedThreadId).ConfigureAwait(true);
                tcs.TrySetResult();
            }
            catch (Exception ex) { tcs.TrySetException(ex); }
        }, null);
        return tcs.Task;
    }

    public void Abandon() =&gt; _queue.CompleteAdding();
    public void Dispose() =&gt; Abandon();
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is a <code>SynchronizationContext</code>, in one sentence?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>An object with a <code>Post(callback, state)</code> method meaning "run this wherever work
        runs in this application". A UI framework implements it by queueing the callback for its
        single UI thread.</p>
      </div></details>
    </li>
    <li>
      <p>Which hosts have one?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>WPF, WinForms, MAUI, .NET Framework ASP.NET, and some test frameworks.
        <strong>Not</strong> ASP.NET Core, console apps or worker services — there
        <code>Current</code> is <code>null</code>, which is why the deadlock is unreachable in modern
        server code.</p>
      </div></details>
    </li>
    <li>
      <p>What does an <code>await</code> capture, and when?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It reads <code>SynchronizationContext.Current</code> before suspending — <strong>per await,
        not per method</strong> — and <code>Post</code>s the continuation back to it on completion. If
        <code>Current</code> is <code>null</code> it falls back to
        <code>TaskScheduler.Current</code>, which by default is the thread pool.</p>
      </div></details>
    </li>
    <li>
      <p>Describe the deadlock in three steps.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The await captures the one-thread context and suspends; the operation completes and posts
        the continuation to that context; the context's only thread is blocked in
        <code>.Result</code> waiting for the continuation it is preventing from running. Permanent,
        not a race.</p>
      </div></details>
    </li>
    <li>
      <p>Is <code>ConfigureAwait(false)</code> on the first await sufficient?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No.</strong> It only leaves the context if that await actually suspends. Measured: a
        first await that completed synchronously left the code on the context, and the second plain
        await deadlocked. The rule is every await in a library.</p>
      </div></details>
    </li>
    <li>
      <p>Who should use <code>ConfigureAwait(false)</code>, and who should not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Libraries should; applications should not.</strong> A library cannot know where it
        will run and should impose no thread requirement. Application code is what knows it needs a
        particular thread — a WPF handler that discards the context throws when it touches a
        control.</p>
      </div></details>
    </li>
    <li>
      <p>What does it cost, and what do you actually lose?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Measured at <strong>0 bytes and within noise on time</strong>. You lose only the guarantee
        about which thread resumes you. You do <strong>not</strong> lose
        <code>AsyncLocal&lt;T&gt;</code> — logging scopes, trace ids and culture ride on
        <code>ExecutionContext</code>, which flows regardless.</p>
      </div></details>
    </li>
    <li>
      <p>ASP.NET Core has no context. Is blocking on async code therefore safe there?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. It will not deadlock, but it occupies a pool thread for the whole operation —
        starvation, measured in <a href="#/m/t2-02-thread-pool">t2-02</a> as 110 ms becoming
        2,917 ms. The failure changed shape from a hang to a latency cliff; it did not disappear.</p>
      </div></details>
    </li>
    <li>
      <p>Are <code>.Result</code>, <code>.Wait()</code> and <code>GetAwaiter().GetResult()</code>
      meaningfully different?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Not for this. All three block the calling thread and all three deadlocked in the same
        measurement. They differ only in exception wrapping — the first two produce
        <code>AggregateException</code>, the third unwraps it.</p>
      </div></details>
    </li>
    <li>
      <p>How would you test a library for this before a consumer finds it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Run its public API under a single-threaded <code>SynchronizationContext</code> from a
        caller that blocks, and assert it completes within a timeout. About twenty lines of test
        helper, and it is the test that would have caught the Ledger incident nine months early.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
