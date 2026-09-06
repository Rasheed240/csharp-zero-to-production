CSPREP.module({
  id: "t2-05-async-state-machine",
  minutes: 55,
  updated: "2026-08-31",
  summary: "Every async method is rewritten by the compiler into a struct with a state field, a builder, and a MoveNext method that resumes where the last await left off. Reading that struct explains the three things that actually matter in production: what an await costs (72 bytes when it does not suspend, ~96 and a thread handoff when it does), which of your locals stay alive for the whole duration of a remote call, and why a hung async request appears on no thread's stack.",
  terms: ["state machine", "MoveNext", "awaiter", "GetAwaiter", "IsCompleted", "OnCompleted",
    "AsyncTaskMethodBuilder", "AsyncVoidMethodBuilder", "hoisted local", "resume point",
    "boxing", "async void", "dumpasync", "unobserved exception", "IAsyncStateMachine"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A service you look after starts refusing requests. Nothing has been deployed for a week. The
  container is not short of CPU — it is sitting at eleven per cent. It is not short of threads;
  there are fourteen, which is normal. Memory is at ninety-four per cent of the limit and climbing
  by about forty megabytes a minute, and when it reaches the limit the orchestrator kills the pod
  and starts a new one, which fills up and gets killed in turn.</p>

  <p>You take a memory dump. The largest thing on the heap is eight thousand byte arrays of one
  megabyte each. You find the code that allocates them: a method that reads an uploaded file into a
  buffer, sends it to a storage service, and returns. The buffer is a local variable. It goes out of
  scope when the method returns. There is no cache, no static field, no collection holding onto
  anything. By every rule you know about how local variables work, those arrays should have been
  collected the moment each upload finished.</p>

  <p>You attach a debugger and set a breakpoint. It never hits, because the requests are not stuck
  in your code — they are waiting on the storage service, which has slowed from forty milliseconds
  to nine seconds. So you ask the obvious next question: which threads are stuck waiting? You dump
  every thread's stack. Your method is not on any of them. Eight thousand requests are in flight and
  not one of them appears on a single stack in the process.</p>

  <p>Both of those facts are strange only if you believe that <code>async</code> is a small
  convenience the compiler provides for writing callbacks more comfortably. It is not. When you mark
  a method <code>async</code>, the compiler <strong>deletes your method</strong> and replaces it with
  a data structure and a function that operates on it. Your local variables become fields of that
  structure. Your control flow becomes a switch statement. The stack frame you think you have does
  not exist between one <code>await</code> and the next.</p>

  <p>Once you can read that structure, both mysteries become the same mystery with one answer, and
  it is an answer you can act on: the buffer survives because it is a field, not a local; the request
  is on no stack because there is no stack. This module is about reading the thing the compiler
  actually built, and about the handful of production decisions that follow directly from it.</p>
</section>

<section id="plain-language">
  <h2>What the compiler actually does</h2>

  <p class="define"><span class="define__term">Compile</span> The step that translates the C# you
  write into the instructions the runtime executes. It happens before the program runs, and it is
  free to restructure your code as long as the observable behaviour is preserved.</p>

  <p class="define"><span class="define__term">State machine</span> A structure that holds a value
  saying "where am I up to", plus a function that reads that value, does the next piece of work, and
  updates it. Anything that must stop partway through and continue later is one, whether or not
  anyone calls it that.</p>

  <p><strong>An analogy, and its limits.</strong> Think of a paper form that several people fill in
  over several days. Nobody sits holding the form while waiting for the next person; it goes into a
  tray. The form has a box at the top saying which section is next, and every fact anyone has
  written so far is written <em>on the form</em>, because there is nowhere else for it to live
  between one person and the next. Anyone can pick it up, read the box, do that section, update the
  box, and put it back down.</p>

  <p>That is exactly the shape of an async method. The form is the state machine. The box at the top
  is the <code>&lt;&gt;1__state</code> field. The facts written on it are your local variables. The
  people are thread pool threads, and the reason no one holds the form while waiting is the reason
  no thread is blocked during an <code>await</code>.</p>

  <p><strong>Where the analogy breaks:</strong> a paper form is passed to a specific person, whereas
  a resumed state machine is put on a queue and taken by whichever thread is free — often the same
  one that put it down, sometimes not. And a form is a single physical object from the start, while
  a state machine begins life on the stack and is copied to the heap only if it turns out to need
  to survive a wait. That second difference is not a detail; it is the entire performance story of
  <code>async</code> in .NET, and we will measure it.</p>

  <p>Here is the transformation, in the smallest form that shows anything. You write this:</p>

  <pre data-lang="csharp" data-net="10" data-title="What you write"><code>static async Task&lt;int&gt; DoubleAfterDelayAsync(int value)
{
    await Task.Delay(10).ConfigureAwait(false);
    return value * 2;
}</code></pre>

  <p>The compiler emits roughly this. It is not exact — the real output uses unspeakable names
  containing characters C# will not accept in an identifier, so that your code can never collide
  with it — but nothing important has been left out:</p>

  <pre data-lang="csharp" data-net="10" data-title="What the compiler emits (paraphrased)"><code>// The method you wrote becomes a stub that starts a machine and returns a Task.
static Task&lt;int&gt; DoubleAfterDelayAsync(int value)
{
    var machine = new DoubleAfterDelayStateMachine
    {
        value = value,                                  // your parameter: now a FIELD
        builder = AsyncTaskMethodBuilder&lt;int&gt;.Create(),
        state = -1                                      // -1 means "not suspended"
    };
    machine.builder.Start(ref machine);                 // runs MoveNext once, right now
    return machine.builder.Task;
}

struct DoubleAfterDelayStateMachine : IAsyncStateMachine
{
    public int state;
    public AsyncTaskMethodBuilder&lt;int&gt; builder;
    public int value;                                   // hoisted local
    private ConfiguredTaskAwaitable.ConfiguredTaskAwaiter awaiter;

    public void MoveNext()
    {
        try
        {
            if (state == 0) goto resume0;               // second and later entries

            awaiter = Task.Delay(10).ConfigureAwait(false).GetAwaiter();
            if (!awaiter.IsCompleted)
            {
                state = 0;                              // remember where to come back to
                builder.AwaitUnsafeOnCompleted(ref awaiter, ref this);
                return;                                 // GIVE THE THREAD BACK
            }

        resume0:
            state = -1;
            awaiter.GetResult();                        // rethrows here if it failed

            builder.SetResult(value * 2);               // completes the Task
        }
        catch (Exception ex)
        {
            builder.SetException(ex);                   // faults the Task instead
        }
    }
}</code></pre>

  <p>Read the <code>return</code> in the middle of <code>MoveNext</code>. That is the whole idea.
  When the awaited operation has not finished, the method returns — not to your caller, who was
  handed a Task and left long ago, but to whatever called <code>MoveNext</code>. The thread is now
  free to do something else entirely. Later, when the delay elapses, something calls
  <code>MoveNext</code> again, the <code>goto</code> jumps past the work already done, and the method
  continues with <code>value</code> intact because <code>value</code> was never on the stack.</p>

  <p class="define"><span class="define__term">Resume point</span> One numbered place a state machine
  can restart from. There is one per <code>await</code> that can suspend, numbered in source order.
  A method with four awaits has states 0 to 3, and the number in the field tells you exactly which
  await a suspended machine is sitting at.</p>

  <p class="define"><span class="define__term">Hoisted local</span> A local variable the compiler
  moved out of the stack frame and into the state machine as a field, because its value has to
  survive a suspension. Hoisting is decided per variable by liveness, not by where you declared it.
  This is the mechanism behind the memory mystery in the opening.</p>

  <p class="define"><span class="define__term">Boxing</span> Copying a value type onto the heap so it
  can outlive the stack frame it was created in. The state machine starts as a struct on the stack
  and is boxed at the first suspension, which is why a method that never suspends can be almost
  free.</p>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <p>You do not have to take the paraphrase on trust. The generated type is in your assembly and you
  can read it with reflection, the same technique <a href="#/m/t1-31-reflection-and-attributes">
  t1-31</a> used for attributes and <a href="#/m/t1-26-iterators-and-yield">t1-26</a> used for
  the iterator state machine that <code>yield return</code> produces.</p>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — the smallest program that shows an async method's
// state machine and the local that had to become a field.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 06-minimal-example.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;

class Program
{
    static async Task&lt;int&gt; DoubleAfterDelayAsync(int value)
    {
        await Task.Delay(10).ConfigureAwait(false);
        return value * 2;                        // 'value' is used AFTER the await
    }

    static void Main()
    {
        Console.WriteLine($"result : {DoubleAfterDelayAsync(21).GetAwaiter().GetResult()}");

        var machine = typeof(Program).Assembly.GetTypes()
            .Single(t =&gt; t.Name.Contains("DoubleAfterDelayAsync"));

        Console.WriteLine($"machine: {machine.Name}");
        Console.WriteLine($"struct : {machine.IsValueType}");
        foreach (var f in machine.GetFields(BindingFlags.Instance |
                                            BindingFlags.Public | BindingFlags.NonPublic))
            Console.WriteLine($"field  : {f.FieldType.Name} {f.Name}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>result : 42
machine: &lt;DoubleAfterDelayAsync&gt;d__0
struct : True
field  : Int32 &lt;&gt;1__state
field  : AsyncTaskMethodBuilder&amp;#96;1 &lt;&gt;t__builder
field  : Int32 value
field  : ConfiguredTaskAwaiter &lt;&gt;u__1</code></pre>

  <p>Four fields, and each one answers a question.</p>

  <p><strong><code>&lt;&gt;1__state</code></strong> is the box at the top of the form. Its value is
  the resume point, or <code>-1</code> when the machine is running or finished.</p>

  <p><strong><code>&lt;&gt;t__builder</code></strong> owns the <code>Task</code> your caller received
  and decides what happens at each suspension. There are three builders and the choice is made by
  your return type: <code>AsyncTaskMethodBuilder&lt;T&gt;</code> for <code>Task&lt;T&gt;</code>,
  <code>AsyncTaskMethodBuilder</code> for <code>Task</code>, and
  <code>AsyncVoidMethodBuilder</code> for <code>async void</code>. That third one has no Task, which
  makes it the most consequential type name in this module.</p>

  <p><strong><code>value</code></strong> is your parameter, now a field, because it is read after the
  await. Note that it kept its name — parameters do — whereas hoisted locals get mangled names like
  <code>&lt;buffer&gt;5__2</code>, which is how you tell them apart in a dump.</p>

  <p><strong><code>&lt;&gt;u__1</code></strong> holds the awaiter while suspended. There is one field
  per distinct awaiter <em>type</em>, not per await, so ten awaits on ten Tasks share one field.</p>

  <p>And <code>struct : True</code> is the line to remember. In a Release build the state machine is
  a value type, so it costs nothing until it has to survive something. Compile the same file with
  <code>-c Debug</code> and it reports <code>False</code>: the debug build emits a class, so that the
  debugger can inspect it reliably. Every allocation number in this module is a Release number.</p>
</section>

<section id="the-awaiter">
  <h2>What <code>await</code> is allowed to await</h2>

  <p>There is no <code>IAwaitable</code> interface. <code>await x</code> compiles if
  <code>x</code> has a <code>GetAwaiter()</code> method returning something with three members:</p>

  <ul>
    <li><code>bool IsCompleted { get; }</code> — is the result already available?</li>
    <li><code>T GetResult()</code> — hand it over, or throw the exception that occurred.</li>
    <li><code>void OnCompleted(Action continuation)</code> — call this back when finished. Supplied
    by implementing <code>INotifyCompletion</code>, the one interface actually required.</li>
  </ul>

  <p>This is a <strong>structural</strong> pattern, matched by shape, in the same way
  <code>foreach</code> matches <code>GetEnumerator</code>. Two consequences follow. The first is that
  you can make your own types awaitable, and even make a third-party type awaitable with an extension
  method you write. The second matters more often: <code>IsCompleted</code> is checked
  <em>before</em> anything suspends, so an awaiter that answers <code>true</code> makes
  <code>await</code> free of everything except a method call.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-the-generated-type.cs"><code>/// &lt;summary&gt;Awaitable without implementing any interface: it has GetAwaiter().&lt;/summary&gt;
readonly struct Countdown
{
    private readonly int _from;
    public Countdown(int from) =&gt; _from = from;
    public CountdownAwaiter GetAwaiter() =&gt; new(_from);
}

readonly struct CountdownAwaiter : INotifyCompletion
{
    private readonly int _from;
    public CountdownAwaiter(int from) =&gt; _from = from;

    // Completing synchronously means await never suspends: no allocation.
    public bool IsCompleted =&gt; true;
    public string GetResult() =&gt; $"counted down from {_from}";
    public void OnCompleted(Action continuation) =&gt; continuation();
}</code></pre>

  <p>That type suspends nothing and allocates nothing, and <code>await new Countdown(3)</code>
  compiles and runs. The first file in the verification folder awaits it to prove the point, and
  prints the fields of all three generated machines alongside it:</p>

  <pre data-lang="console" data-title="01-the-generated-type.cs (extract)"><code>  &lt;AddAsync&gt;d__0
    nested in   : Program
    is a STRUCT : True
    interfaces  : IAsyncStateMachine
    field       : Int32                                    &lt;&gt;1__state
    field       : AsyncTaskMethodBuilder&amp;#96;1                 &lt;&gt;t__builder
    field       : Int32                                    a
    field       : Int32                                    b
    field       : Int32                                    &lt;partial&gt;5__2
    field       : ConfiguredTaskAwaiter                    &lt;&gt;u__1

--- the awaiter pattern is structural, not an interface ---
  awaiter type    : ConfiguredTaskAwaiter
  IsCompleted     : True
  GetResult()     : True
  INotifyCompletion : True

--- awaiting a custom type, to prove the point ---
  awaited a Countdown and got : counted down from 3</code></pre>

  <p>The reason to care is that <code>IsCompleted</code> is the switch controlling every cost in the
  next section. A cache that answers from memory returns a completed awaiter and the state machine
  runs to the end in a single pass. A cache that misses returns an incomplete one, and only then
  does any of the expensive machinery engage.</p>
</section>

<section id="cost">
  <h2>What an <code>await</code> costs</h2>

  <p>"Async has overhead" is not a usable statement. There are two paths with an order of magnitude
  between them, and which one you are on is a property of your data, not your code.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-cost.cs"><code>    // --- the synchronous path -------------------------------------------------
    static int PlainSync() =&gt; 4242;
    static async Task&lt;int&gt; NoAwait() { return 4242; }
    static async Task&lt;int&gt; NoAwaitSmall() { return 1; }
    static async Task&lt;bool&gt; NoAwaitBool() { return true; }
    static async Task&lt;int&gt; AwaitCompleted() { await Task.CompletedTask; return 4242; }
    static async ValueTask&lt;int&gt; VtAwaitCompleted() { await Task.CompletedTask; return 4242; }
    static Task&lt;int&gt; FromResult() =&gt; Task.FromResult(4242);
    static ValueTask&lt;int&gt; VtNoAsync() =&gt; new(4242);

    // --- the suspending path --------------------------------------------------
    static async Task&lt;int&gt; Suspends() { await Task.Yield(); return 4242; }
    static async ValueTask&lt;int&gt; VtSuspends() { await Task.Yield(); return 4242; }</code></pre>

  <pre data-lang="console" data-title="02-cost.cs"><code>=== 1. an await that never suspends ===

  method                            bytes/call   ns/call
  plain sync method                           0         8
  async Task&lt;int&gt;, no await at all           72        49
  async Task&lt;int&gt;, await completed           72        60
  async ValueTask&lt;int&gt;, await done            0        76
  Task.FromResult, not async                 72        21
  ValueTask, not async                        0        16

=== 2. an await that DOES suspend ===

  method                            bytes/call   ns/call
  async Task&lt;int&gt;, suspends                  96     1,185
  async ValueTask&lt;int&gt;, suspends            104     1,302</code></pre>

  <p><strong>Nothing suspended in the first block</strong>, and the async methods still cost 72 bytes
  and around 50 nanoseconds. That is the price of the compiler having to hand back a
  <code>Task&lt;int&gt;</code> before it can possibly know whether one was needed. The second row is
  worth staring at: a method marked <code>async</code> that contains <em>no <code>await</code> at
  all</em> pays exactly the same 72 bytes as one that awaits something already finished.</p>

  <p><strong>Suspension costs about twenty times as much time and half as much again in memory.</strong>
  The extra 24 bytes are the boxed state machine on the heap; the extra microsecond is the
  continuation delegate, the queue, and a thread picking the work back up.</p>

  <p>Note the <code>ValueTask</code> rows against what
  <a href="#/m/t2-04-task-and-valuetask">t2-04</a> established. It removes the allocation on the
  synchronous path and is the <em>slowest</em> row in nanoseconds while doing it, and on the
  suspending path it costs more than <code>Task</code> on both counts. It buys memory with time. Those
  are different currencies and the exchange rate depends on your hit rate.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>The benchmark that lies to you.</strong> The first version of this measurement returned
    <code>1</code> from every method and reported <code>0</code> bytes for all of them, which would
    have made this section argue the opposite of the truth. The runtime keeps pre-made
    <code>Task</code> objects for small integers and both booleans:</p>
    <pre data-lang="console" data-title="02-cost.cs, section 1b"><code>  async Task&lt;int&gt; returning 4242             72        45
  async Task&lt;int&gt; returning 1                 0        37
  async Task&lt;bool&gt; returning true             0        33</code></pre>
    <p>This is a genuine optimisation — an <code>async Task&lt;bool&gt;</code> that completes
    synchronously really is free — and a genuine trap. Any microbenchmark of async overhead that
    returns a small int, a bool, or nothing at all measures the cache and not the machinery.</p>
  </div>

  <p>The third measurement is the one that converts all of this into a rule you can apply:</p>

  <pre data-lang="console" data-title="02-cost.cs, section 3"><code>  5 awaits, 0 of which had to wait -&gt; suspended 0 time(s)
  5 awaits, 3 of which had to wait -&gt; suspended 3 time(s)</code></pre>

  <p><code>MoveNext</code> runs once to start plus once per resumption, so those two runs entered it
  once and four times — for identical source code with the same five awaits. <strong>The number of
  <code>await</code> keywords in a method has almost no bearing on what it costs. The number that
  actually have to wait is everything.</strong> That is why adding a cache in front of a call can
  make an async method cheaper without deleting a single <code>await</code>, and why the same
  method's cost profile changes under load without any deployment.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>Ledger — the payments and invoicing service these modules build up — exports settlements to the
  bank every night. Two hundred payments, one file service call each. The job had run unchanged for
  a year:</p>

  <pre data-lang="csharp" data-net="10" data-title="The job, before"><code>    /// &lt;summary&gt;Sequential, and the shape the job had before the change.&lt;/summary&gt;
    public async Task RunSequentialAsync(List&lt;Payment&gt; payments, CancellationToken ct = default)
    {
        foreach (var p in payments)
            await _sink.WriteAsync(p, ct).ConfigureAwait(false);
    }</code></pre>

  <p>During a tidy-up sprint someone replaced the <code>foreach</code> with the collection's own
  <code>ForEach</code> method. It reads better, it is a one-line diff, and every test passed:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the one-line change that broke it silently"><code>public void RunBroken(List&lt;Payment&gt; payments)
{
    payments.ForEach(async p =&gt; await _sink.WriteAsync(p).ConfigureAwait(false));
}</code></pre>

  <p>Nine nights green. On the tenth, the bank asked where the money was.</p>

  <pre data-lang="console" data-title="04-production.cs"><code>  ForEach with an async lambda:
    returned after          : 7 ms
    written when it returned: 0 of 200
    written 500 ms later    : 200 of 200
    threw                   : nothing

  the same job written correctly:
    sequential :  3,104 ms   written 200
    concurrent :     12 ms   written 200</code></pre>

  <p><code>List&lt;T&gt;.ForEach</code> takes an <code>Action</code>. An <code>Action</code> returns
  <code>void</code>. So the async lambda compiled as <strong><code>async void</code></strong> — and
  nobody typed those words anywhere in the file. The compiler chose it, silently, from the delegate
  type the method wanted.</p>

  <p>An <code>async void</code> method produces no Task, so there is nothing to await and nothing to
  hold a failure. <code>ForEach</code> returned the instant all two hundred state machines reached
  their first suspension, having written zero payments. The job returned, its caller logged success,
  and the process exited with the machines still suspended on the heap. The writes in that output
  landed only because the verification file sleeps for half a second afterwards to let them.</p>

  <p>The 7 ms is not a speed-up. It is how long it takes to start two hundred operations and abandon
  them.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Why nine nights of success, then a crash.</strong> On night ten one payment was
    rejected. In the correct version that exception travels through the Task, surfaces at
    <code>await</code>, fails the job and pages someone. In the broken version there is no Task to
    carry it, so <code>AsyncVoidMethodBuilder</code> rethrows it on a thread pool thread — where an
    unhandled exception terminates the process. The outage was not a failed export. It was a crash
    loop in a job that had been reporting success while exporting nothing.</p>
  </div>

  <p>Both correct shapes are shown below. Which one you want is a real decision — sequential is
  259 times slower here but applies backpressure to the file service, whereas
  <code>WhenAll</code> starts all two hundred at once. What they share is that both return a
  <code>Task</code> that the caller must await, so neither can lie about having finished.</p>

  <pre data-lang="csharp" data-net="10" data-title="Both correct shapes"><code>
    /// &lt;summary&gt;Sequential, and the shape the job had before the change.&lt;/summary&gt;
    public async Task RunSequentialAsync(List&lt;Payment&gt; payments, CancellationToken ct = default)
    {
        foreach (var p in payments)
            await _sink.WriteAsync(p, ct).ConfigureAwait(false);
    }

    /// &lt;summary&gt;Concurrent and awaited. Every failure is still observed.&lt;/summary&gt;
    public async Task RunConcurrentAsync(List&lt;Payment&gt; payments, CancellationToken ct = default)
    {
        await Task.WhenAll(payments.Select(p =&gt; _sink.WriteAsync(p, ct))).ConfigureAwait(false);</code></pre>

  <p>The state machine is where the bug is visible without reading a line of the logic. Every async
  method and lambda in the assembly, with the builder each one chose:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>  state machine                                 builder
  ExportJob.&lt;&lt;RunBroken&gt;b__2_0&gt;d                AsyncVoidMethodBuilder
  Program.&lt;BufferDiesEarly&gt;d__3                 AsyncTaskMethodBuilder&amp;#96;1
  Program.&lt;BufferLivesAcross&gt;d__4               AsyncTaskMethodBuilder&amp;#96;1
  ExportJob.&lt;RunConcurrentAsync&gt;d__4            AsyncTaskMethodBuilder
  ExportJob.&lt;RunSequentialAsync&gt;d__3            AsyncTaskMethodBuilder
  ExportSink.&lt;WriteAsync&gt;d__3                   AsyncTaskMethodBuilder</code></pre>

  <p>One <code>AsyncVoidMethodBuilder</code>, and it belongs to the lambda inside
  <code>RunBroken</code>. Grepping the source for "async void" would have found nothing.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Read the name of that first row.</strong> A method's state machine is called
    <code>&lt;Method&gt;d__N</code>; a lambda's is called <code>&lt;&lt;Method&gt;b__N_M&gt;d</code>.
    The first version of this code listed types whose name contained <code>d__</code> and found
    nothing, because lambda machines do not match that pattern. It now filters on the
    <code>IAsyncStateMachine</code> interface instead. The same trap applies in a dump: searching
    <code>dumpasync</code> output for a method name will miss the lambda that is actually stuck.</p>
  </div>

  <h3>The second half of the same story</h3>

  <p>Now back to the opening: the buffers that would not die. Two methods, same 8 MB array, same
  length, one line moved:</p>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>    const int BufferBytes = 8 * 1024 * 1024;

    static async Task&lt;long&gt; BufferDiesEarly(Task gate)
    {
        var buffer = new byte[BufferBytes];
        long sum = buffer.Length;                 // last use is BEFORE the await
        await gate.ConfigureAwait(false);
        return sum;
    }

    static async Task&lt;long&gt; BufferLivesAcross(Task gate)
    {
        var buffer = new byte[BufferBytes];
        await gate.ConfigureAwait(false);
        return buffer.Length;                     // last use is AFTER the await
    }</code></pre>

  <pre data-lang="console" data-title="04-production.cs"><code>  BufferDiesEarly      hoisted locals: Task gate, Int64 &lt;sum&gt;5__2
  BufferLivesAcross    hoisted locals: Task gate, Byte[] &lt;buffer&gt;5__2

  Measured, with 50 of each suspended at once:
    dies before the await   :     0.0 MB held
    lives across the await  :   400.0 MB held</code></pre>

  <p>In the first method the last use of <code>buffer</code> is before the <code>await</code>, so the
  compiler leaves it a real local on a stack frame that unwinds at the suspension, and the array is
  collectable while the remote call is in flight. In the second the last use is after, so
  <code>buffer</code> becomes <code>&lt;buffer&gt;5__2</code>, a field of a heap object that stays
  reachable for the entire duration of the call. Fifty concurrent operations, 400 MB held, for as
  long as the storage service takes.</p>

  <p>That is the answer to the opening mystery, and it explains why the incident began with no
  deployment: when the storage service slowed from 40 ms to 9 seconds, the amount of memory held per
  request was multiplied by 225 without a line of code changing. <strong>Hoisting turns your
  dependency's latency into your memory usage.</strong></p>

  <p>The rule that falls out of it: keep large objects out of the region between an allocation and an
  <code>await</code>. Finish with the buffer first, or push it into a separate non-async method so it
  goes out of scope before you suspend.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. <code>async void</code>, in all the forms that do not say <code>async void</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: four async voids, none of them declared"><code>// WRONG (1). List&lt;T&gt;.ForEach takes an Action.
payments.ForEach(async p =&gt; await SendAsync(p));

// WRONG (2). TimerCallback returns void.
var timer = new Timer(async _ =&gt; await PollAsync(), null, 0, 1000);

// WRONG (3). Assigning an async lambda to a void-returning delegate.
Action refresh = async () =&gt; await ReloadCacheAsync();

// WRONG (4). An event handler signature, outside a UI framework.
public async void OnMessageReceived(object? sender, MessageEventArgs e)
    =&gt; await HandleAsync(e.Message);

// Right: keep a Task and await it.
foreach (var p in payments)
    await SendAsync(p, ct);

// Right: Task-returning delegate.
Func&lt;Task&gt; refresh = async () =&gt; await ReloadCacheAsync();</code></pre>

  <p>Each of the four returns to its caller at the first suspension, having done nothing, and each
  converts any exception into a process kill. The compiler warning you might hope for,
  <strong>CS4014</strong> ("this call is not awaited"), does not fire on any of them — CS4014 fires
  when you discard a <em>Task</em>, and here there is no Task to discard. That is precisely why they
  slip through review.</p>

  <p>The rule is narrow and absolute: <code>async void</code> is for event handlers in frameworks
  that require the signature, and for nothing else. Everywhere else it converts a handled error into
  an outage.</p>

  <h3>2. Assuming an async method throws at the call site</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: validation that fires far too late"><code>// WRONG. This does not throw when called. It returns a faulted Task, and the
// ArgumentNullException surfaces wherever someone eventually awaits it — which
// may be a different method, a different thread, or never.
public async Task&lt;Receipt&gt; PayAsync(Invoice invoice, CancellationToken ct)
{
    ArgumentNullException.ThrowIfNull(invoice);
    await _gateway.ChargeAsync(invoice.Total, ct);
    return new Receipt(invoice.Id);
}

// Right: validate in a non-async wrapper, so it throws at the call site.
public Task&lt;Receipt&gt; PayAsync(Invoice invoice, CancellationToken ct)
{
    ArgumentNullException.ThrowIfNull(invoice);
    return PayCoreAsync(invoice, ct);

    async Task&lt;Receipt&gt; PayCoreAsync(Invoice i, CancellationToken token)
    {
        await _gateway.ChargeAsync(i.Total, token);
        return new Receipt(i.Id);
    }
}</code></pre>

  <p>An <code>async</code> method never throws to its caller. <code>MoveNext</code> is wrapped in a
  try/catch that routes every exception into <code>builder.SetException</code>, so even a throw on
  the first line becomes a faulted Task. If the caller does not await it, the failure is silent. The
  wrapper is not stylistic — it is the difference between a stack trace pointing at the bad call and
  one pointing at wherever the Task was eventually observed.</p>

  <h3>3. Holding a large object across an <code>await</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: 1 MB per in-flight request"><code>// WRONG. 'buffer' is read after the await, so it is hoisted into the state
// machine and stays reachable for the whole upload.
public async Task&lt;string&gt; StoreAsync(Stream upload, CancellationToken ct)
{
    var buffer = new byte[1024 * 1024];
    var read = await upload.ReadAsync(buffer, ct);
    return await _storage.PutAsync(buffer.AsMemory(0, read), ct);
}

// Right: rent from the shared pool and return it, so the memory is bounded by
// concurrency rather than multiplied by it.
public async Task&lt;string&gt; StoreAsync(Stream upload, CancellationToken ct)
{
    var buffer = ArrayPool&lt;byte&gt;.Shared.Rent(1024 * 1024);
    try
    {
        var read = await upload.ReadAsync(buffer, ct);
        return await _storage.PutAsync(buffer.AsMemory(0, read), ct);
    }
    finally
    {
        ArrayPool&lt;byte&gt;.Shared.Return(buffer);
    }
}</code></pre>

  <p>The pooled version still hoists the reference — it must, since the buffer is used after both
  awaits — but the array is reused across requests instead of allocated per request, so total memory
  tracks peak concurrency rather than total requests in flight multiplied by latency.</p>

  <h3>4. Dropping a Task and losing the failure entirely</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a failure with no symptom"><code>// WRONG. The Task faults, and nothing anywhere observes it.
_ = _auditLog.RecordAsync(entry);

// Right, when you genuinely do not want to wait: observe the failure.
_ = _auditLog.RecordAsync(entry).ContinueWith(
        t =&gt; _logger.LogError(t.Exception, "audit write failed"),
        CancellationToken.None,
        TaskContinuationOptions.OnlyOnFaulted,
        TaskScheduler.Default);</code></pre>

  <p>Since .NET 4.5 an unobserved Task exception does not crash the process — it evaporates during
  garbage collection. This is the quietest failure mode in .NET, because the symptom is not an error
  in a log. It is a piece of work that never happened.</p>

  <h3>5. Reading the current stack and expecting to see the caller</h3>

  <p>Any helper that calls <code>new StackTrace()</code> to find out who invoked it will see the
  truth about async rather than the reconstruction. The next section shows exactly what it sees.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a request has been in flight for minutes. You dump every thread and
    your code is on none of them.</p>
    <p><strong>Why:</strong> a suspended state machine is a heap object, not a stack frame. It exists
    on no thread, so <code>clrstack -all</code> cannot find it and neither can a debugger's thread
    list. Nothing is wrong; you are looking in the wrong place.</p>
    <p><strong>Tool:</strong></p>
    <pre data-lang="console" data-title="Finding suspended async work"><code>dotnet-dump collect --process-id 4812
dotnet-dump analyze core_20260831.dmp
&gt; dumpasync --stats        # grouped by type: find the pile-up
&gt; dumpasync                # every suspended machine and its chain
&gt; dumpasync --completed    # include ones that have finished</code></pre>
    <p><strong>Reading it:</strong> <code>dumpasync</code> walks the heap rather than the stacks and
    reconstructs the logical async call chain — for each machine, its type, its state field, and the
    machine waiting on it. Thousands of the same type at the same state number means thousands of
    requests blocked at the same <code>await</code>. Count the awaits in that method in source order
    to find which one: state 0 is the first, state 1 the second.</p>
    <p><strong>Fix:</strong> the state number names the dependency. Then it is a timeout, a
    cancellation token that is not being honoured, or a lock nobody is releasing.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a logging or tracing helper reports the wrong caller, or a profiler's
    sampled stacks are uselessly shallow.</p>
    <p><strong>Why:</strong> exception stack traces are <em>reconstructed</em>. Since .NET Core 2.1
    the runtime stitches async frames back into the names you wrote, so the
    <code>MoveNext</code> noise in older articles is gone. The physical stack is a different thing
    entirely.</p>
    <p><strong>Reading it:</strong> both, captured from the same method at the same moment:</p>
    <pre data-lang="console" data-title="03-failure-modes.cs"><code>  stack trace as thrown from three async frames down:
    at Program.InnerAsync() in 03-failure-modes.cs:line 200
    at Program.MiddleAsync() in 03-failure-modes.cs:line 194
    at Program.OuterAsync() in 03-failure-modes.cs:line 189
    at Program.Main() in 03-failure-modes.cs:line 25

  the physical stack, inside the same method after the suspension:
    at Program.PhysicalStackAsync()
    at AsyncTaskMethodBuilder&amp;#96;1.AsyncStateMachineBox&amp;#96;1.ExecutionContextCallback(Object s)
    at ExecutionContext.RunInternal(ExecutionContext, ContextCallback, Object)
    at AsyncTaskMethodBuilder&amp;#96;1.AsyncStateMachineBox&amp;#96;1.MoveNext(Thread threadPoolThread)
    at AsyncTaskMethodBuilder&amp;#96;1.AsyncStateMachineBox&amp;#96;1.MoveNext()
    at AwaitTaskContinuation.RunOrScheduleAction(IAsyncStateMachineBox box, Boolean allowInlining)</code></pre>
    <p>No Middle, no Outer, no Main. The thread running that code has never heard of them; it took
    the continuation off the pool queue. Those frames were on a stack that unwound at the first
    suspension.</p>
    <p><strong>Fix:</strong> never derive a caller from the runtime stack in async code. Use
    <code>[CallerMemberName]</code>, which the compiler fills in at the call site, or an explicit
    correlation identifier flowed through <code>AsyncLocal&lt;T&gt;</code> or your logging scope.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> a background job reports success and does nothing; or a process dies
    with an unhandled exception whose stack trace points at code inside a <code>try</code>.</p>
    <p><strong>Tool:</strong> reflect over the assembly and look at which builder each state machine
    chose. Six lines, and it is exhaustive in a way that grep is not:</p>
    <pre data-lang="csharp" data-net="10" data-title="Find every async void in an assembly"><code>var machines = assembly.GetTypes()
    .SelectMany(t =&gt; t.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic).Prepend(t))
    .Where(t =&gt; typeof(IAsyncStateMachine).IsAssignableFrom(t) &amp;&amp; t.IsValueType)
    .Where(t =&gt; t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                 .Any(f =&gt; f.FieldType == typeof(AsyncVoidMethodBuilder)));

foreach (var m in machines)
    Console.WriteLine($"async void: {m.DeclaringType?.Name}.{m.Name}");</code></pre>
    <p><strong>Better fix — catch it at compile time.</strong> Add the analyser package and this stops
    being a debugging problem:</p>
    <pre data-lang="console" data-title="The analysers that catch this class of bug"><code>dotnet add package Microsoft.VisualStudio.Threading.Analyzers

VSTHRD100  avoid async void methods
VSTHRD101  avoid an async lambda for a void-returning delegate   &lt;-- the ForEach bug
VSTHRD002  avoid problematic synchronous waits (.Result, .Wait())
VSTHRD110  observe the result of async calls</code></pre>
    <p>VSTHRD101 is the rule that would have caught the settlement export before it shipped.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> memory grows with your dependency's latency rather than with your
    own traffic, and a profiler shows the retained objects are local variables.</p>
    <p><strong>Tool:</strong> ask the compiler which locals it hoisted, rather than guessing:</p>
    <pre data-lang="csharp" data-net="10" data-title="List the hoisted locals of one method"><code>var machine = typeof(UploadService).Assembly.GetTypes()
    .Single(t =&gt; t.Name.Contains("StoreAsync"));

foreach (var f in machine.GetFields(BindingFlags.Instance |
                                    BindingFlags.Public | BindingFlags.NonPublic))
    Console.WriteLine($"{f.FieldType.Name} {f.Name}");</code></pre>
    <p><strong>Reading it:</strong> compiler-generated names tell you what each field is. Fields
    starting <code>&lt;&gt;</code> are machinery — state, builder, awaiters. A field named
    <code>&lt;name&gt;5__N</code> is one of your locals, hoisted. A field with a plain name is a
    parameter. Anything of a large or expensive type in that list is held for every concurrent
    call.</p>
    <p><strong>Fix:</strong> move the last use of the large object before the first
    <code>await</code>, extract it into a non-async helper, or rent it from
    <code>ArrayPool&lt;T&gt;.Shared</code> so the memory is bounded by concurrency.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> work that should have happened did not, with no error anywhere.</p>
    <p><strong>Tool:</strong> subscribe at startup and log:</p>
    <pre data-lang="csharp" data-net="10" data-title="Surface dropped Task failures"><code>TaskScheduler.UnobservedTaskException += (_, e) =&gt;
{
    logger.LogError(e.Exception, "unobserved task exception");
    e.SetObserved();
};</code></pre>
    <p><strong>Reading it:</strong> it fires during garbage collection, so it is late and unordered
    and will not name the call site. Treat it as a detector, not a diagnosis: it tells you dropped
    Tasks exist, and then you go and find them with VSTHRD110.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Latency becomes memory, at a multiplier you do not control.</strong> A service handling
    900 requests a second, each holding a 1 MB buffer across an <code>await</code>, at a normal
    dependency latency of 40 ms, holds roughly 36 in-flight requests and 36 MB. Nothing changes in
    your code when that dependency degrades to 9 seconds — but concurrency rises to about 8,100 and
    the same buffers now hold 8.1 GB. The measurement in this module shows the mechanism directly:
    50 suspended operations held 400 MB when the buffer was read after the await and 0 MB when it was
    read before. One line moved, and the pod either survives its dependency's bad day or dies to
    OOM. This is the single highest-leverage thing to know about the state machine.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A silent job is worse than a failed one, and <code>async void</code> makes jobs
    silent.</strong> Ledger's settlement export returned in 7 ms having written 0 of 200 payments and
    exited with a success code. Nine nightly runs passed monitoring — no error rate, no latency
    alarm, no failed health check — because every signal the job emitted was true and none of them
    described what it had done. The reconciliation gap was found by the counterparty, not by
    us. Then, on the first payment rejection, the same bug turned a routine data error into a crash
    loop. Both halves come from one fact: <code>async void</code> has no Task, so it can neither be
    waited for nor report failure.</p>
  </div>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>Your cache hit rate is your async overhead.</strong> An endpoint doing five lookups per
    request at 20,000 requests per second performs 100,000 awaits a second. At a 100% hit rate none
    of them suspend and the total cost is around 7 MB/s of short-lived garbage. At a 0% hit rate all
    of them do, and it is 9.6 MB/s <em>plus</em> 100,000 continuation scheduling operations per
    second, each around a microsecond of thread pool work — roughly a tenth of a core spent purely on
    suspension bookkeeping, and the difference shows up in gen-0 collection frequency long before it
    shows up in your latency graphs. The source code is identical in both cases. This is why "we
    added a cache and CPU went down more than we expected" is a real and common observation.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>async</code> is syntactic sugar for callbacks."</strong> It is a whole-method
    rewrite into a type you never see, with your locals relocated into fields and your control flow
    turned into a resumable switch. The difference is not academic: it is why a local variable can
    outlive its scope, and why your method appears on no thread's stack.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Every <code>await</code> costs a thread switch."</strong> Only awaits where
    <code>IsCompleted</code> is false cost anything beyond a method call. Five awaits over a warm
    cache suspended zero times and cost 0 bytes; the same five over a cold cache suspended five times
    and cost 1,624 bytes. Identical code.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An <code>async</code> method with no <code>await</code> is free — the compiler
    optimises it away."</strong> It does not. It measured 72 bytes and 49 ns per call, the same as one
    that awaits something already completed. If a method has no await, remove the
    <code>async</code> keyword and return <code>Task.FromResult</code> or
    <code>Task.CompletedTask</code>. The compiler will warn you (CS1998) — the warning is worth
    acting on rather than suppressing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Async stack traces are unreadable."</strong> They were, before .NET Core 2.1. They now
    show your method names and line numbers. What is genuinely gone is the <em>physical</em> stack —
    which affects <code>new StackTrace()</code>, sampled profiles and <code>clrstack</code>, but not
    the exception you are reading in your logs.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>async void</code> is fine as long as I handle exceptions inside."</strong> A
    try/catch inside does contain the exceptions, and the caller still cannot wait for the method,
    still cannot know whether it succeeded, and still returns before the work is done. It also
    survives exactly until someone adds a code path that throws outside the try. Return a
    <code>Task</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The compiler hoists all my locals, so it makes no difference where I declare
    them."</strong> It hoists exactly those whose values must survive a suspension. In the measured
    example, <code>before</code> and <code>after</code> stayed real locals and only <code>across</code>
    became a field. Where the <em>last use</em> sits relative to the <code>await</code> is what
    decides, which is why moving one line changed 400 MB into 0 MB.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"More <code>await</code>s means a bigger, slower state machine."</strong> One machine
    is generated per async method or lambda, no matter how many awaits it contains — ten awaits give
    one machine with ten resume points. The field count grows with hoisted locals and distinct awaiter
    types, not with await count.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <p>Every answer below is produced by running <code>05-exercises.cs</code>, included in full at the
  end of the module. Predict before you reveal — several of these have answers that contradict a
  reasonable first guess.</p>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Three locals, one <code>await</code>. Which of them become fields of the state machine, and
    why?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>static async Task&lt;int&gt; ThreeLocals(Task gate)
{
    var before = 1;
    var across = before + 1;
    _sink += before;
    await gate.ConfigureAwait(false);
    var after = across + 1;
    return across + after;
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>    hoisted : Task gate
    hoisted : Int32 &lt;across&gt;5__2</code></pre>
        <p><strong>Only <code>across</code>, plus the parameter <code>gate</code>.</strong>
        <code>before</code> is finished with before the suspension, so it stays a real local on a
        stack frame that unwinds and its value is not preserved. <code>after</code> is created after
        the resumption and never has to survive anything, so it stays a local too.</p>
        <p><strong>The rule is liveness across the suspension point</strong> — not declaration order,
        not scope. Note that <code>after</code> is declared later in the source than the
        <code>await</code> and is not hoisted, while <code>across</code> is declared before it and
        is. What decides is whether the value must still be readable on the other side.</p>
        <p><strong>Reading the names matters in a dump.</strong> Parameters keep their original names
        (<code>gate</code>); hoisted locals are renamed to <code>&lt;name&gt;5__N</code>
        (<code>&lt;across&gt;5__2</code>). Fields beginning <code>&lt;&gt;</code> with no name inside
        the brackets are machinery — state, builder, awaiters — and are not yours.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>An assembly contains eleven async methods — one of which has ten <code>await</code>s — plus two
    async lambdas. How many state machine types does the compiler generate?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Thirteen.</strong> One per async method and one per async lambda. The await count
        is irrelevant: the method with ten awaits gets one machine with ten resume points, numbered
        0 to 9 in its state field.</p>
        <pre data-lang="console" data-title="Actual output"><code>  state machines in this assembly : 13
    &lt;&gt;c.&lt;&lt;RegisterHandlers&gt;b__12_0&gt;d
    &lt;&gt;c.&lt;&lt;RegisterHandlers&gt;b__12_1&gt;d
    Program.&lt;&lt;ValidatedThrows&gt;g__Inner|9_0&gt;d
    Program.&lt;A&gt;d__3
    Program.&lt;B&gt;d__4
    Program.&lt;C&gt;d__5
    Program.&lt;D&gt;d__6
    Program.&lt;E&gt;d__7
    Program.&lt;FiveLookups&gt;d__11
    Cache.&lt;GetAsync&gt;d__5
    Program.&lt;ThreeLocals&gt;d__2
    Program.&lt;ThrowsAfterAwait&gt;d__10
    Program.&lt;ThrowsBeforeAwait&gt;d__8</code></pre>
        <p>Three naming conventions appear there and all three are worth being able to read:
        <code>&lt;Method&gt;d__N</code> for a method,
        <code>&lt;&lt;Method&gt;b__N_M&gt;d</code> for a lambda, and
        <code>&lt;&lt;Method&gt;g__Local|N_M&gt;d</code> for a local function. The lambda ones are
        nested inside a compiler-generated <code>&lt;&gt;c</code> class, which is why enumerating only
        top-level types misses them.</p>
        <p>What <em>does</em> grow with await count is the number of resume points, and what grows the
        struct is hoisted locals plus one field per distinct awaiter <em>type</em>. Ten awaits on ten
        different Tasks still share one <code>&lt;&gt;u__1</code>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Rank these five by bytes allocated per call, then check. Four of them will surprise you if you
    reason only from the return type.</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>static async Task&lt;int&gt; A() { await Task.CompletedTask; return 4242; }
static async Task&lt;int&gt; B() { await Task.CompletedTask; return 1; }
static async Task       C() { await Task.CompletedTask; }
static async ValueTask&lt;int&gt; D() { await Task.CompletedTask; return 4242; }
static async Task&lt;int&gt; E() { await Task.Yield(); return 4242; }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  variant                                bytes/call
    async Task&lt;int&gt;, returns 4242              72
    async Task&lt;int&gt;, returns 1                  0
    async Task (no result)                      0
    async ValueTask&lt;int&gt;, returns 4242          0
    async Task&lt;int&gt;, suspends                  96</code></pre>
        <p><strong>A</strong> pays the full 72 bytes for a <code>Task&lt;int&gt;</code> it must
        construct to hold 4242.</p>
        <p><strong>B</strong> is free because 1 falls in the runtime's small-integer Task cache. This
        is both a real optimisation and the reason most published async microbenchmarks are wrong: a
        benchmark returning a small int measures the cache, not the machinery.</p>
        <p><strong>C</strong> is free because with no result there is a shared completed
        <code>Task</code> singleton to hand back.</p>
        <p><strong>D</strong> is free because a synchronously-completed
        <code>ValueTask&lt;int&gt;</code> carries the value inside the struct — no heap object is
        needed at all. This is the case <a href="#/m/t2-04-task-and-valuetask">t2-04</a> was about.</p>
        <p><strong>E</strong> is the only one that suspends, and it is the only expensive one: 96
        bytes, being the 72 plus the state machine boxed onto the heap.</p>
        <p><strong>The ranking is not by return type.</strong> Four of the five never touch the
        expensive path, and the fifth does — not because of what it returns, but because
        <code>Task.Yield()</code> always reports <code>IsCompleted == false</code>.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This method throws before its first <code>await</code>. Does the caller see the exception at
    the call site, or somewhere else? Then say where you would put an argument check so that it
    behaves the way a caller expects.</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>static async Task&lt;int&gt; ThrowsBeforeAwait()
{
    throw new InvalidOperationException("thrown before any await");
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  (a) throw BEFORE the first await, method returns Task
      the call itself returned normally : task status Faulted
      it surfaced at the await : thrown before any await

  (b) the same check in a non-async wrapper
      threw at the CALL SITE, before any Task existed

  (c) throw AFTER an await
      surfaced at the await : thrown after an await</code></pre>
        <p><strong>The call returns normally, handing back an already-<code>Faulted</code> Task.</strong>
        This is not a special case for early throws. <code>MoveNext</code> wraps your entire method
        body in a try/catch that routes every exception into
        <code>builder.SetException</code>, so <strong>an <code>async</code> method never throws to its
        caller</strong> — not for a null argument, not for anything.</p>
        <p>That has a consequence worth sitting with: if the caller does not await the Task, the
        failure is never seen by anyone. An argument bug becomes silence rather than a crash.</p>
        <p>The fix is a non-async wrapper that validates eagerly and then delegates:</p>
        <pre data-lang="csharp" data-net="10" data-title="The non-async wrapper"><code>static Task&lt;int&gt; ValidatedThrows(string input)
{
    ArgumentNullException.ThrowIfNull(input);
    return Inner();
    static async Task&lt;int&gt; Inner() { await Task.CompletedTask; return 1; }
}</code></pre>
        <p>The outer method is not <code>async</code>, so its body runs on the caller's stack and its
        throw propagates normally. The local function keeps the async logic. Now programmer errors
        throw at the call site with a stack trace pointing at the offending caller, while genuine
        operational failures still travel through the Task where they belong.</p>
        <p>This is the same reasoning as the argument-validation pattern for iterators in
        <a href="#/m/t1-26-iterators-and-yield">t1-26</a> — for the same underlying reason, since both
        are compiler-generated state machines whose bodies do not run when you call them.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>One method, five <code>await</code>s, run three times against caches of different warmth.
    Predict the shape of the result. Then answer the harder question: the source code is byte for byte
    identical across all three runs, so what exactly is it that differs?</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 5"><code>static async Task FiveLookups(Cache cache)
{
    for (var i = 0; i &lt; 5; i++)
        _sink += await cache.GetAsync(i).ConfigureAwait(false);
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>  warm entries   suspensions   bytes/run   ms/run
             5             0           0        0
             3             2         760       31
             0             5        1624       78</code></pre>
        <p><strong>Suspensions, bytes and time all scale together, and nothing about the code
        changed.</strong> What differs is the answer <code>IsCompleted</code> gives.</p>
        <p>The cache returns a <code>ValueTask&lt;int&gt;</code>. On a hit it holds the value directly,
        its awaiter reports <code>IsCompleted == true</code>, and <code>MoveNext</code> falls straight
        through the <code>await</code> without saving state or registering a continuation. Five hits
        means the whole loop runs to completion inside a single <code>MoveNext</code> call, on one
        thread, with no heap traffic whatsoever — the top row is genuinely 0 bytes.</p>
        <p>On a miss the awaiter reports false, and only then does the machinery engage: box the state
        machine, allocate a continuation, register it, return the thread, and later have some thread
        pick the work back up. Each of those is the ~96 bytes and ~1.2 µs from section 2.</p>
        <p><strong>The practical conclusion is the most useful thing in this module.</strong> You do
        not tune async code by removing <code>await</code>s — the keyword is nearly free. You tune it
        by reducing how many of them have to wait, which usually means caching, batching, or removing
        a round trip. It also means the cost profile of your service changes when a dependency slows
        down, with no deployment involved.</p>
        <div class="callout callout--gotcha">
          <h4>Gotcha</h4>
          <p><strong>A measurement mistake worth not repeating.</strong> The first version of this
          used <code>GC.GetAllocatedBytesForCurrentThread()</code> and reported the same 472 bytes for
          both the two-suspension and five-suspension rows, which would have made this exercise argue
          nothing. Continuations run on <em>pool</em> threads, so a per-thread counter misses most of
          the allocation. The file uses
          <code>GC.GetTotalAllocatedBytes(precise: true)</code> instead. If you are ever benchmarking
          async code and the numbers refuse to move, check that your counter can see the threads the
          work actually ran on.</p>
        </div>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Neither of these lines contains the words <code>async void</code>. Both create one. Explain
    why, then write code that finds every such case in a compiled assembly without reading the
    source.</p>
    <pre data-lang="csharp" data-net="10" data-title="Exercise 6"><code>var items = new List&lt;int&gt; { 1, 2, 3 };
items.ForEach(async i =&gt; { await Task.Delay(i).ConfigureAwait(false); });
_ = new Timer(async _ =&gt; { await Task.Delay(1).ConfigureAwait(false); }, null, -1, -1);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><code>List&lt;T&gt;.ForEach</code> takes an <code>Action&lt;T&gt;</code> and
        <code>Timer</code> takes a <code>TimerCallback</code>. Both return <code>void</code>, so each
        async lambda compiles with <code>AsyncVoidMethodBuilder</code>. <strong>The lambda's own
        source says nothing about it — the delegate type it was assigned to made the decision.</strong>
        This is why searching a codebase for the string "async void" is not a control.</p>
        <pre data-lang="csharp" data-net="10" data-title="Finding them by builder type"><code>var voids = allStateMachines.Where(x =&gt;
    x.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
     .Any(f =&gt; f.FieldType == typeof(AsyncVoidMethodBuilder)));</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>  state machines using AsyncVoidMethodBuilder : 2
    &lt;&gt;c.&lt;&lt;RegisterHandlers&gt;b__12_0&gt;d
    &lt;&gt;c.&lt;&lt;RegisterHandlers&gt;b__12_1&gt;d</code></pre>
        <p>Two subtleties, both of which produced a wrong answer of zero while this module was being
        written. The builder field is <strong>public</strong> on the generated struct, so omitting
        <code>BindingFlags.Public</code> finds nothing. And these types are nested inside a
        compiler-generated <code>&lt;&gt;c</code> class, so enumerating only top-level types finds
        nothing either — you have to walk nested types recursively.</p>
        <p><strong>In practice you would not write this.</strong> You would add
        <code>Microsoft.VisualStudio.Threading.Analyzers</code> and let <strong>VSTHRD101</strong>
        fail the build, which catches the problem at the point where it is cheap to fix. The
        reflection version is for the situation this module opened with: a binary, a production
        incident, and a need to know now.</p>
      </div>
    </details>
  </div>
</section>

<section id="full-source">
  <h2>The complete verification programs</h2>

  <p>Every number quoted in this module comes from these files. They are complete .NET 10 file-based
  apps: save one and run <code>dotnet run 02-cost.cs -c Release</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-cost.cs"><code>// 02-cost.cs — what an await actually costs, measured on both paths: the one
// where it completes synchronously and never suspends, and the one where it does.
// The gap between them is the whole design.
//
// A NOTE ON THE RETURN VALUE. An earlier version of this file returned 1 from
// every method and every row read 0 bytes, which contradicted the point it was
// making. AsyncTaskMethodBuilder&lt;int&gt; keeps cached Task objects for small
// results, so returning 1 measures the cache rather than the state machine.
// These methods return 4242 to get past it, and section 1b shows the cache.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-cost.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;
    static int _resumptions;

    static void Main()
    {
        Console.WriteLine("=== 1. an await that never suspends ===");
        Console.WriteLine();
        Console.WriteLine("  Every one of these returns a value the caller can have immediately.");
        Console.WriteLine("  None of them suspends. The differences are all in what the compiler");
        Console.WriteLine("  is forced to build before it finds that out.");
        Console.WriteLine();
        Console.WriteLine("  method                            bytes/call   ns/call");
        Row("plain sync method", () =&gt; _sink += PlainSync());
        Row("async Task&lt;int&gt;, no await at all", () =&gt; _sink += NoAwait().GetAwaiter().GetResult());
        Row("async Task&lt;int&gt;, await completed", () =&gt; _sink += AwaitCompleted().GetAwaiter().GetResult());
        Row("async ValueTask&lt;int&gt;, await done", () =&gt; _sink += VtAwaitCompleted().GetAwaiter().GetResult());
        Row("Task.FromResult, not async", () =&gt; _sink += FromResult().GetAwaiter().GetResult());
        Row("ValueTask, not async", () =&gt; _sink += VtNoAsync().GetAwaiter().GetResult());

        Console.WriteLine();
        Console.WriteLine("  Read the first three rows together. The sync method allocates nothing.");
        Console.WriteLine("  The async methods allocate even though NOTHING SUSPENDED, because the");
        Console.WriteLine("  compiler must hand back a Task before it can know that.");
        Console.WriteLine("  ValueTask is the row that fixes the allocation: 0 bytes on this path.");
        Console.WriteLine("  Note that it is also the SLOWEST row in nanoseconds. It buys memory,");
        Console.WriteLine("  not speed, and the two are not the same currency — which is why the");
        Console.WriteLine("  previous module made the choice a question about hit rate rather than");
        Console.WriteLine("  a general recommendation.");

        Console.WriteLine();
        Console.WriteLine("=== 1b. the same method returning 1 instead of 4242 ===");
        Console.WriteLine();
        Console.WriteLine("  method                            bytes/call   ns/call");
        Row("async Task&lt;int&gt; returning 4242", () =&gt; _sink += NoAwait().GetAwaiter().GetResult());
        Row("async Task&lt;int&gt; returning 1", () =&gt; _sink += NoAwaitSmall().GetAwaiter().GetResult());
        Row("async Task&lt;bool&gt; returning true", () =&gt; _sink += NoAwaitBool().GetAwaiter().GetResult() ? 1 : 0);
        Console.WriteLine();
        Console.WriteLine("  The runtime keeps pre-made Task objects for small ints and for both");
        Console.WriteLine("  bools, so an async method returning one of those can allocate nothing");
        Console.WriteLine("  at all. Worth knowing for two reasons: it is a real optimisation you");
        Console.WriteLine("  get for free on Task&lt;bool&gt;, and it is a trap when benchmarking — a");
        Console.WriteLine("  microbenchmark that returns 1 will tell you async is free.");

        Console.WriteLine();
        Console.WriteLine("=== 2. an await that DOES suspend ===");
        Console.WriteLine();
        Console.WriteLine("  Same shape, but the awaited thing has not finished, so the state");
        Console.WriteLine("  machine must be boxed onto the heap and a continuation registered.");
        Console.WriteLine();
        Console.WriteLine("  method                            bytes/call   ns/call");
        Row("async Task&lt;int&gt;, suspends", () =&gt; _sink += Suspends().GetAwaiter().GetResult(), reps: 20_000);
        Row("async ValueTask&lt;int&gt;, suspends", () =&gt; _sink += VtSuspends().GetAwaiter().GetResult(), reps: 20_000);

        Console.WriteLine();
        Console.WriteLine("  Compare with section 1. Suspension is where the cost is: the boxed");
        Console.WriteLine("  state machine, the continuation delegate, the queue, the thread");
        Console.WriteLine("  handoff. And ValueTask costs MORE than Task here, because a suspended");
        Console.WriteLine("  ValueTask allocates a Task and then wraps it in a struct.");

        Console.WriteLine();
        Console.WriteLine("=== 3. how often the state machine actually suspends ===");
        Console.WriteLine();
        _resumptions = 0;
        CountingAwaits(suspendCount: 0).GetAwaiter().GetResult();
        Console.WriteLine($"  5 awaits, 0 of which had to wait -&gt; suspended {_resumptions} time(s)");

        _resumptions = 0;
        CountingAwaits(suspendCount: 3).GetAwaiter().GetResult();
        Console.WriteLine($"  5 awaits, 3 of which had to wait -&gt; suspended {_resumptions} time(s)");

        Console.WriteLine();
        Console.WriteLine("  This counts calls to OnCompleted on the awaiter, which is the runtime");
        Console.WriteLine("  saying: not finished, call me back. MoveNext runs once to start plus");
        Console.WriteLine("  once per resumption, so those two runs entered MoveNext 1 and 4 times");
        Console.WriteLine("  for the same five awaits.");
        Console.WriteLine("  An await that completes synchronously costs no extra MoveNext: the");
        Console.WriteLine("  state machine falls straight through it inside the same call. That is");
        Console.WriteLine("  why an async method over a warm cache is nearly free and the same");
        Console.WriteLine("  method over a cold one is not — the number of awaits did not change.");

        Console.WriteLine();
        Console.WriteLine("=== 4. how much a deep async call chain costs ===");
        Console.WriteLine();
        Console.WriteLine("  depth   bytes/call   ns/call   ns per layer");
        foreach (var depth in new[] { 1, 2, 4, 8, 16 })
        {
            var d = depth;
            var bytes = Alloc(() =&gt; _sink += Nest(d).GetAwaiter().GetResult(), 100_000);
            var ns = Nanos(() =&gt; _sink += Nest(d).GetAwaiter().GetResult(), 100_000);
            Console.WriteLine($"  {depth,5}   {bytes,10}   {ns,7:N0}   {ns / depth,12:N0}");
        }
        Console.WriteLine();
        Console.WriteLine("  Nothing suspends here, so each extra layer is one more state machine");
        Console.WriteLine("  and one more Task. Allocation is exactly linear: 72 bytes per layer,");
        Console.WriteLine("  every time, which is the same 72 from section 1.");
        Console.WriteLine("  Time is SUB-linear — the per-layer column falls as depth grows, because");
        Console.WriteLine("  the JIT inlines more of the chain once it is hot. Do not read that as a");
        Console.WriteLine("  reason to nest deeply: it is a microbenchmark with no real work in it,");
        Console.WriteLine("  and the allocation column is the one that follows you into production.");
        Console.WriteLine("  The honest summary is that a deep async chain that never suspends is");
        Console.WriteLine("  cheap and predictable. The cost you care about is in section 2.");

        Console.WriteLine();
        Console.WriteLine($"  (checksum {_sink})");
    }

    // --- the synchronous path -------------------------------------------------
    static int PlainSync() =&gt; 4242;
    static async Task&lt;int&gt; NoAwait() { return 4242; }
    static async Task&lt;int&gt; NoAwaitSmall() { return 1; }
    static async Task&lt;bool&gt; NoAwaitBool() { return true; }
    static async Task&lt;int&gt; AwaitCompleted() { await Task.CompletedTask; return 4242; }
    static async ValueTask&lt;int&gt; VtAwaitCompleted() { await Task.CompletedTask; return 4242; }
    static Task&lt;int&gt; FromResult() =&gt; Task.FromResult(4242);
    static ValueTask&lt;int&gt; VtNoAsync() =&gt; new(4242);

    // --- the suspending path --------------------------------------------------
    static async Task&lt;int&gt; Suspends() { await Task.Yield(); return 4242; }
    static async ValueTask&lt;int&gt; VtSuspends() { await Task.Yield(); return 4242; }

    // --- counting suspensions -------------------------------------------------
    static async Task CountingAwaits(int suspendCount)
    {
        for (var i = 0; i &lt; 5; i++)
            await new Counted(suspend: i &lt; suspendCount);
    }

    // --- nesting --------------------------------------------------------------
    static async Task&lt;int&gt; Nest(int depth)
    {
        if (depth &lt;= 1) return 4242;
        return await Nest(depth - 1).ConfigureAwait(false);
    }

    // --- measurement ----------------------------------------------------------
    static void Row(string label, Action a, int reps = 200_000)
    {
        var bytes = Alloc(a, reps);
        var ns = Nanos(a, reps);
        Console.WriteLine($"  {label,-34} {bytes,10}   {ns,7:N0}");
    }

    static long Alloc(Action a, int reps)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i &lt; reps; i++) a();
        return (GC.GetAllocatedBytesForCurrentThread() - before) / reps;
    }

    static double Nanos(Action a, int reps)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; reps; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / reps;
    }

    /// &lt;summary&gt;An awaitable that records when it forces a suspension.&lt;/summary&gt;
    readonly struct Counted
    {
        private readonly bool _suspend;
        public Counted(bool suspend) =&gt; _suspend = suspend;
        public CountedAwaiter GetAwaiter() =&gt; new(_suspend);
    }

    readonly struct CountedAwaiter : INotifyCompletion
    {
        private readonly bool _suspend;
        public CountedAwaiter(bool suspend) =&gt; _suspend = suspend;

        // IsCompleted returning false is the ONLY thing that causes a suspension.
        public bool IsCompleted =&gt; !_suspend;
        public void GetResult() { }
        public void OnCompleted(Action continuation)
        {
            Interlocked.Increment(ref _resumptions);
            ThreadPool.QueueUserWorkItem(_ =&gt; continuation());
        }
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — Ledger's nightly settlement export, and the one-line change
// that made it stop working while continuing to report success. Then the second
// half of the same story: what the state machine keeps alive while it is
// suspended, and how to see it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-production.cs -c Release
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

namespace Ledger.Settlement;

public sealed record Payment(string Reference, decimal Amount);

/// &lt;summary&gt;Stands in for the remote settlement file service.&lt;/summary&gt;
public sealed class ExportSink
{
    private int _written;
    public int Written =&gt; Volatile.Read(ref _written);

    public async Task WriteAsync(Payment payment, CancellationToken ct = default)
    {
        await Task.Delay(5, ct).ConfigureAwait(false);
        if (payment.Reference.StartsWith("BAD", StringComparison.Ordinal))
            throw new InvalidOperationException($"rejected by settlement: {payment.Reference}");
        Interlocked.Increment(ref _written);
    }
}

public sealed class ExportJob
{
    private readonly ExportSink _sink;
    public ExportJob(ExportSink sink) =&gt; _sink = sink;

    /// &lt;summary&gt;
    /// THE BUG. List&lt;T&gt;.ForEach takes an Action, so this async lambda compiled
    /// as async void. ForEach returns the instant every state machine hits its
    /// first await, and the job reports success having written nothing.
    /// &lt;/summary&gt;
    public void RunBroken(List&lt;Payment&gt; payments)
    {
        payments.ForEach(async p =&gt; await _sink.WriteAsync(p).ConfigureAwait(false));
    }

    /// &lt;summary&gt;Sequential, and the shape the job had before the change.&lt;/summary&gt;
    public async Task RunSequentialAsync(List&lt;Payment&gt; payments, CancellationToken ct = default)
    {
        foreach (var p in payments)
            await _sink.WriteAsync(p, ct).ConfigureAwait(false);
    }

    /// &lt;summary&gt;Concurrent and awaited. Every failure is still observed.&lt;/summary&gt;
    public async Task RunConcurrentAsync(List&lt;Payment&gt; payments, CancellationToken ct = default)
    {
        await Task.WhenAll(payments.Select(p =&gt; _sink.WriteAsync(p, ct))).ConfigureAwait(false);
    }
}

class Program
{
    static void Main()
    {
        var payments = Enumerable.Range(0, 200)
            .Select(i =&gt; new Payment($"PAY-{i:D4}", 10m + i))
            .ToList();

        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger exports 200 settlements a night. A developer changed a foreach");
        Console.WriteLine("  loop to payments.ForEach(...) during a tidy-up. Tests passed. The job");
        Console.WriteLine("  ran green for nine nights. On the tenth, the bank asked where the");
        Console.WriteLine("  money was.");
        Console.WriteLine();

        var brokenSink = new ExportSink();
        var job = new ExportJob(brokenSink);
        var sw = Stopwatch.StartNew();
        job.RunBroken(payments);
        var brokenMs = sw.Elapsed.TotalMilliseconds;
        var writtenAtReturn = brokenSink.Written;
        Thread.Sleep(500);

        Console.WriteLine("  ForEach with an async lambda:");
        Console.WriteLine($"    returned after          : {brokenMs:N0} ms");
        Console.WriteLine($"    written when it returned: {writtenAtReturn} of {payments.Count}");
        Console.WriteLine($"    written 500 ms later    : {brokenSink.Written} of {payments.Count}");
        Console.WriteLine("    threw                   : nothing");
        Console.WriteLine();
        Console.WriteLine("  Look at the middle two lines. The job returned having written ZERO");
        Console.WriteLine("  payments, in single-digit milliseconds, and exited zero. The writes");
        Console.WriteLine("  did all land eventually — but only because this file sleeps for half");
        Console.WriteLine("  a second afterwards to let them. A real job returns, its caller logs");
        Console.WriteLine("  success, and the process exits with the state machines still");
        Console.WriteLine("  suspended. Whatever had not finished never does.");
        Console.WriteLine("  Note also that the 9 ms is not a speed-up. It is the time taken to");
        Console.WriteLine("  START 200 operations and abandon them.");

        Console.WriteLine();
        Console.WriteLine("  the same job written correctly:");
        var seqSink = new ExportSink();
        sw = Stopwatch.StartNew();
        new ExportJob(seqSink).RunSequentialAsync(payments).GetAwaiter().GetResult();
        Console.WriteLine($"    sequential : {sw.Elapsed.TotalMilliseconds,6:N0} ms   written {seqSink.Written}");

        var conSink = new ExportSink();
        sw = Stopwatch.StartNew();
        new ExportJob(conSink).RunConcurrentAsync(payments).GetAwaiter().GetResult();
        Console.WriteLine($"    concurrent : {sw.Elapsed.TotalMilliseconds,6:N0} ms   written {conSink.Written}");

        Console.WriteLine();
        Console.WriteLine("=== and the failure that turned it into an outage ===");
        Console.WriteLine();
        var withBad = new List&lt;Payment&gt;(payments) { new("BAD-9999", 1m) };

        Console.WriteLine("  correct version, one payment rejected:");
        try
        {
            new ExportJob(new ExportSink()).RunConcurrentAsync(withBad).GetAwaiter().GetResult();
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"    threw {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine("    the job fails, the alert fires, someone fixes the payment.");
        }

        Console.WriteLine();
        Console.WriteLine("  broken version, same payment: the exception has no Task to live in.");
        Console.WriteLine("  AsyncVoidMethodBuilder rethrows it on a thread pool thread, and an");
        Console.WriteLine("  unhandled exception on a pool thread terminates the process.");
        Console.WriteLine("  That is what happened on night ten: not a failed export — a crash");
        Console.WriteLine("  loop, in a job that had been reporting success for nine nights while");
        Console.WriteLine("  exporting nothing.");
        Console.WriteLine("  (This file does not run that case, because it would take the process");
        Console.WriteLine("  with it. 03-failure-modes.cs demonstrates it under a context that");
        Console.WriteLine("  catches it.)");

        Console.WriteLine();
        Console.WriteLine("=== how the state machine gives it away ===");
        Console.WriteLine();
        var lambdas = AllTypes(typeof(ExportJob).Assembly)
            .Where(t =&gt; typeof(IAsyncStateMachine).IsAssignableFrom(t) &amp;&amp; t != typeof(IAsyncStateMachine))
            .OrderBy(t =&gt; t.Name, StringComparer.Ordinal);

        Console.WriteLine("  state machine                                 builder");
        foreach (var t in lambdas)
        {
            var builder = t.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
                .FirstOrDefault(f =&gt; f.Name.Contains("builder"));
            if (builder is null) continue;
            var name = t.DeclaringType is null ? t.Name : $"{t.DeclaringType.Name}.{t.Name}";
            Console.WriteLine($"  {name,-44}  {builder.FieldType.Name}");
        }
        Console.WriteLine();
        Console.WriteLine("  AsyncVoidMethodBuilder is the tell. There is exactly one in this");
        Console.WriteLine("  assembly and it belongs to the lambda inside RunBroken. Nobody wrote");
        Console.WriteLine("  'async void' anywhere in the file — the compiler chose it because");
        Console.WriteLine("  ForEach wanted an Action.");
        Console.WriteLine();
        Console.WriteLine("  Note the NAME of that first row. A state machine for a method is");
        Console.WriteLine("  called &lt;Method&gt;d__N; one for a lambda is called &lt;&lt;Method&gt;b__N_M&gt;d.");
        Console.WriteLine("  The first version of this file listed types whose name contained");
        Console.WriteLine("  'd__' and found nothing, because lambda machines do not match that.");
        Console.WriteLine("  This code now filters on the IAsyncStateMachine interface instead.");
        Console.WriteLine("  The same trap applies in a dump: grepping dumpasync output for a");
        Console.WriteLine("  method name will miss the lambda that is actually stuck.");
        Console.WriteLine();
        Console.WriteLine("  Three ways to catch this before it ships:");
        Console.WriteLine("    1. Compiler warning CS4014 fires on an un-awaited Task call, but NOT");
        Console.WriteLine("       here — there is no Task. That is why it slipped through.");
        Console.WriteLine("    2. Microsoft.VisualStudio.Threading.Analyzers, VSTHRD101, flags an");
        Console.WriteLine("       async lambda being converted to a void-returning delegate. This");
        Console.WriteLine("       is the rule that would have caught it.");
        Console.WriteLine("    3. A test that asserts the sink received 200 writes rather than");
        Console.WriteLine("       asserting the job returned without throwing.");

        Console.WriteLine();
        Console.WriteLine("=== part two: what a suspended state machine holds onto ===");
        Console.WriteLine();
        Console.WriteLine("  A local that is live ACROSS an await becomes a field, so it survives");
        Console.WriteLine("  the suspension — and stays alive for as long as the await does.");
        Console.WriteLine("  A local that is finished with before the await does not.");
        Console.WriteLine();

        foreach (var name in new[] { "BufferDiesEarly", "BufferLivesAcross" })
        {
            var t = typeof(Program).Assembly.GetTypes().First(x =&gt; x.Name.Contains(name));
            var fields = t.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
                .Where(f =&gt; !f.Name.StartsWith("&lt;&gt;", StringComparison.Ordinal))
                .Select(f =&gt; $"{f.FieldType.Name} {f.Name}")
                .ToArray();
            Console.WriteLine($"  {name,-20} hoisted locals: " +
                              (fields.Length == 0 ? "(none)" : string.Join(", ", fields)));
        }

        Console.WriteLine();
        Console.WriteLine("  Same 8 MB buffer, same method length, one line moved. The second one");
        Console.WriteLine("  keeps 8 MB reachable for the whole duration of the remote call.");
        Console.WriteLine("  At 500 concurrent requests that is the difference between a working");
        Console.WriteLine("  service and an OutOfMemoryException, and neither profiler nor code");
        Console.WriteLine("  review shows it, because the buffer LOOKS local and short-lived.");
        Console.WriteLine();
        Console.WriteLine("  Measured, with 50 of each suspended at once:");
        Console.WriteLine($"    dies before the await   : {MeasureHeld(early: true),7:N1} MB held");
        Console.WriteLine($"    lives across the await  : {MeasureHeld(early: false),7:N1} MB held");
        Console.WriteLine();
        Console.WriteLine("  The rule that falls out of this: keep large objects out of the region");
        Console.WriteLine("  between an allocation and an await. Finish with the buffer, or scope");
        Console.WriteLine("  it into a separate non-async method, before you suspend.");
    }

    static IEnumerable&lt;Type&gt; AllTypes(Assembly assembly)
    {
        var seen = new List&lt;Type&gt;();
        void Walk(Type t)
        {
            seen.Add(t);
            foreach (var n in t.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic))
                Walk(n);
        }
        foreach (var t in assembly.GetTypes())
            if (!t.IsNested) Walk(t);
        return seen;
    }

    const int BufferBytes = 8 * 1024 * 1024;

    static async Task&lt;long&gt; BufferDiesEarly(Task gate)
    {
        var buffer = new byte[BufferBytes];
        long sum = buffer.Length;                 // last use is BEFORE the await
        await gate.ConfigureAwait(false);
        return sum;
    }

    static async Task&lt;long&gt; BufferLivesAcross(Task gate)
    {
        var buffer = new byte[BufferBytes];
        await gate.ConfigureAwait(false);
        return buffer.Length;                     // last use is AFTER the await
    }

    static double MeasureHeld(bool early)
    {
        var gate = new TaskCompletionSource();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var before = GC.GetTotalMemory(forceFullCollection: true);

        var pending = new List&lt;Task&lt;long&gt;&gt;();
        for (var i = 0; i &lt; 50; i++)
            pending.Add(early ? BufferDiesEarly(gate.Task) : BufferLivesAcross(gate.Task));

        Thread.Sleep(100);                        // all 50 are now suspended at the await
        var during = GC.GetTotalMemory(forceFullCollection: true);

        gate.SetResult();
        Task.WhenAll(pending).GetAwaiter().GetResult();
        return (during - before) / 1024.0 / 1024.0;
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="05-exercises.cs"><code>// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-exercises.cs -c Release
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
    static long _sink;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which locals become fields? =====");
        Console.WriteLine();
        Console.WriteLine("  Predict, then read. Three locals, one await, three different fates.");
        Console.WriteLine();
        var t = Machine("ThreeLocals");
        foreach (var f in Hoisted(t))
            Console.WriteLine($"    hoisted : {f}");
        Console.WriteLine();
        Console.WriteLine("    'before' is used only before the await   -&gt; NOT hoisted (a real local)");
        Console.WriteLine("    'across' is used on both sides           -&gt; hoisted");
        Console.WriteLine("    'after'  is assigned after the await     -&gt; NOT hoisted");
        Console.WriteLine("  The rule is liveness, not declaration order: a local is hoisted only");
        Console.WriteLine("  if its value must survive a suspension. This is why moving one line");
        Console.WriteLine("  can change a method's memory profile without changing what it does.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how many state machines does this create? =====");
        Console.WriteLine();
        var all = AllTypes(typeof(Program).Assembly)
            .Where(x =&gt; typeof(IAsyncStateMachine).IsAssignableFrom(x) &amp;&amp; x != typeof(IAsyncStateMachine))
            .ToArray();
        Console.WriteLine($"  state machines in this assembly : {all.Length}");
        Console.WriteLine("  one per async METHOD and one per async LAMBDA:");
        foreach (var m in all.OrderBy(x =&gt; x.Name, StringComparer.Ordinal))
            Console.WriteLine($"    {m.DeclaringType?.Name}.{m.Name}");
        Console.WriteLine();
        Console.WriteLine("  Note that the number of AWAITS does not affect the count. Ten awaits");
        Console.WriteLine("  in one method is one state machine with ten resume points; one await");
        Console.WriteLine("  in each of ten methods is ten state machines.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which of these allocate? =====");
        Console.WriteLine();
        Console.WriteLine("  variant                                bytes/call");
        Console.WriteLine($"    async Task&lt;int&gt;, returns 4242        {Alloc(() =&gt; _sink += A().GetAwaiter().GetResult()),8}");
        Console.WriteLine($"    async Task&lt;int&gt;, returns 1           {Alloc(() =&gt; _sink += B().GetAwaiter().GetResult()),8}");
        Console.WriteLine($"    async Task (no result)               {Alloc(() =&gt; C().GetAwaiter().GetResult()),8}");
        Console.WriteLine($"    async ValueTask&lt;int&gt;, returns 4242   {Alloc(() =&gt; _sink += D().GetAwaiter().GetResult()),8}");
        Console.WriteLine($"    async Task&lt;int&gt;, suspends            {Alloc(() =&gt; _sink += E().GetAwaiter().GetResult(), 20_000),8}");
        Console.WriteLine();
        Console.WriteLine("  'async Task' with no result allocates nothing on the synchronous path:");
        Console.WriteLine("  there is a shared already-completed Task singleton to hand back. Only");
        Console.WriteLine("  Task&lt;T&gt; for an uncached T has to build one.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: where does the exception surface? =====");
        Console.WriteLine();
        Console.WriteLine("  (a) throw BEFORE the first await, method returns Task");
        var before = ThrowsBeforeAwait();
        Console.WriteLine($"      the call itself returned normally : task status {before.Status}");
        try { before.GetAwaiter().GetResult(); }
        catch (InvalidOperationException ex) { Console.WriteLine($"      it surfaced at the await : {ex.Message}"); }
        Console.WriteLine("      An async method NEVER throws at the call site, even for an");
        Console.WriteLine("      argument check. The exception is captured into the Task.");
        Console.WriteLine("      This is why argument validation belongs in a non-async wrapper:");

        Console.WriteLine();
        Console.WriteLine("  (b) the same check in a non-async wrapper");
        try { ValidatedThrows(null!); }
        catch (ArgumentNullException) { Console.WriteLine("      threw at the CALL SITE, before any Task existed"); }

        Console.WriteLine();
        Console.WriteLine("  (c) throw AFTER an await");
        try { ThrowsAfterAwait().GetAwaiter().GetResult(); }
        catch (InvalidOperationException ex) { Console.WriteLine($"      surfaced at the await : {ex.Message}"); }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: count the suspensions =====");
        Console.WriteLine();
        Console.WriteLine("  Same method, same five awaits, different cache temperature.");
        Console.WriteLine();
        Console.WriteLine("  warm entries   suspensions   bytes/run   ms/run");
        foreach (var warm in new[] { 5, 3, 0 })
        {
            const int Runs = 40;
            FiveLookups(new Cache(warm)).GetAwaiter().GetResult();      // warm up
            GC.Collect();
            GC.WaitForPendingFinalizers();

            var counted = new Cache(warm);
            var sw = Stopwatch.StartNew();
            // Process-wide: the continuations allocate on POOL threads, so the
            // per-thread counter would miss most of it and report the same
            // number for two and five suspensions.
            var bytes = GC.GetTotalAllocatedBytes(precise: true);
            for (var r = 0; r &lt; Runs; r++)
                FiveLookups(counted).GetAwaiter().GetResult();
            bytes = (GC.GetTotalAllocatedBytes(precise: true) - bytes) / Runs;
            Console.WriteLine($"  {warm,12}   {counted.Suspensions / Runs,11}   {bytes,9}   " +
                              $"{sw.Elapsed.TotalMilliseconds / Runs,6:N0}");
        }
        Console.WriteLine();
        Console.WriteLine("  The source code did not change between those three rows. The number");
        Console.WriteLine("  of awaits did not change. What changed is how many of them had to");
        Console.WriteLine("  wait, and that is the only thing the cost depends on.");
        Console.WriteLine("  This is the single most useful idea in the module: async is cheap");
        Console.WriteLine("  when it does not suspend, and you control how often it suspends.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: find the async void =====");
        Console.WriteLine();
        var voids = all.Where(x =&gt; x.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
                                    .Any(f =&gt; f.FieldType == typeof(AsyncVoidMethodBuilder)))
                       .ToArray();
        Console.WriteLine($"  state machines using AsyncVoidMethodBuilder : {voids.Length}");
        foreach (var v in voids)
            Console.WriteLine($"    {v.DeclaringType?.Name}.{v.Name}");
        Console.WriteLine();
        Console.WriteLine("  Neither of those has the words 'async void' at its declaration. One is");
        Console.WriteLine("  a lambda passed to List&lt;T&gt;.ForEach; the other is passed to a Timer.");
        Console.WriteLine("  Searching the source for 'async void' would find neither.");
        Console.WriteLine("  Reflecting over the builder type finds both, and so does VSTHRD101.");

        Console.WriteLine();
        Console.WriteLine($"  (checksum {_sink})");
    }

    // Exercise 1
    static async Task&lt;int&gt; ThreeLocals(Task gate)
    {
        var before = 1;
        var across = before + 1;
        Console.Out.Flush();
        _sink += before;
        await gate.ConfigureAwait(false);
        var after = across + 1;
        return across + after;
    }

    // Exercise 3
    static async Task&lt;int&gt; A() { await Task.CompletedTask; return 4242; }
    static async Task&lt;int&gt; B() { await Task.CompletedTask; return 1; }
    static async Task C() { await Task.CompletedTask; }
    static async ValueTask&lt;int&gt; D() { await Task.CompletedTask; return 4242; }
    static async Task&lt;int&gt; E() { await Task.Yield(); return 4242; }

    // Exercise 4
    static async Task&lt;int&gt; ThrowsBeforeAwait()
    {
        throw new InvalidOperationException("thrown before any await");
    }

    static Task&lt;int&gt; ValidatedThrows(string input)
    {
        ArgumentNullException.ThrowIfNull(input);
        return Inner();
        static async Task&lt;int&gt; Inner() { await Task.CompletedTask; return 1; }
    }

    static async Task&lt;int&gt; ThrowsAfterAwait()
    {
        await Task.Yield();
        throw new InvalidOperationException("thrown after an await");
    }

    // Exercise 5
    static async Task FiveLookups(Cache cache)
    {
        for (var i = 0; i &lt; 5; i++)
            _sink += await cache.GetAsync(i).ConfigureAwait(false);
    }

    // Exercise 6: two async voids that never say "async void"
    static void RegisterHandlers()
    {
        var items = new List&lt;int&gt; { 1, 2, 3 };
        items.ForEach(async i =&gt; { await Task.Delay(i).ConfigureAwait(false); });
        _ = new Timer(async _ =&gt; { await Task.Delay(1).ConfigureAwait(false); }, null, -1, -1);
    }

    // --- helpers --------------------------------------------------------------
    static Type Machine(string methodName) =&gt;
        AllTypes(typeof(Program).Assembly).First(t =&gt; t.Name.Contains(methodName));

    static string[] Hoisted(Type machine) =&gt;
        machine.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .Where(f =&gt; !f.Name.StartsWith("&lt;&gt;", StringComparison.Ordinal))
            .Select(f =&gt; $"{f.FieldType.Name} {f.Name}")
            .ToArray();

    static IEnumerable&lt;Type&gt; AllTypes(Assembly assembly)
    {
        var seen = new List&lt;Type&gt;();
        void Walk(Type t)
        {
            seen.Add(t);
            foreach (var n in t.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic))
                Walk(n);
        }
        foreach (var t in assembly.GetTypes())
            if (!t.IsNested) Walk(t);
        return seen;
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
}

/// &lt;summary&gt;A cache with a controllable hit rate, counting its own suspensions.&lt;/summary&gt;
sealed class Cache
{
    private readonly int _warmCount;
    private int _suspensions;

    public Cache(int warmCount) =&gt; _warmCount = warmCount;
    public int Suspensions =&gt; Volatile.Read(ref _suspensions);

    public async ValueTask&lt;int&gt; GetAsync(int key)
    {
        if (key &lt; _warmCount) return key;            // synchronous: no suspension
        Interlocked.Increment(ref _suspensions);
        await Task.Delay(10).ConfigureAwait(false);  // suspends
        return key;
    }
}</code></pre>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What are the fields of a generated state machine, and what is each one for?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>&lt;&gt;1__state</code> — the resume point, <code>-1</code> when running or finished.
        <code>&lt;&gt;t__builder</code> — owns the Task and handles suspension and completion.
        One <code>&lt;&gt;u__N</code> per distinct awaiter <em>type</em>, holding the awaiter across a
        suspension. Then one field per parameter and per hoisted local.</p>
      </div></details>
    </li>
    <li>
      <p>Why is the state machine a struct, and when does that stop mattering?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>So a method that completes without suspending never puts it on the heap. At the first
        suspension the builder boxes it so it can outlive the stack frame — which is exactly the
        <strong>72 to 96 byte</strong> jump measured in section 2. In a Debug build it is emitted as a
        class instead, so allocation numbers taken from a Debug build mean nothing.</p>
      </div></details>
    </li>
    <li>
      <p>Which of your locals become fields?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Those whose values must survive a suspension — live across an <code>await</code>. Decided
        by <strong>liveness, not declaration order</strong>. Measured: of three locals, only the one
        read on both sides of the await was hoisted. Parameters keep their names; hoisted locals are
        renamed <code>&lt;name&gt;5__N</code>.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>await</code> require of the thing being awaited?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <code>GetAwaiter()</code> method returning a type with <code>IsCompleted</code>,
        <code>GetResult()</code> and <code>OnCompleted(Action)</code>. It is a <strong>structural</strong>
        pattern, not an interface, which is why you can make your own types awaitable — and why
        <code>IsCompleted</code> returning true makes an <code>await</code> cost nothing but a method
        call.</p>
      </div></details>
    </li>
    <li>
      <p>Roughly what does an <code>await</code> cost on each of the two paths?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Not suspending: <strong>72 bytes and about 50 ns</strong> for <code>Task&lt;T&gt;</code>,
        0 bytes for <code>ValueTask&lt;T&gt;</code>. Suspending: <strong>about 96 bytes and
        1,200 ns</strong>. The number of awaits barely matters; the number that actually have to wait
        is everything.</p>
      </div></details>
    </li>
    <li>
      <p>Why can a hung async request appear on no thread's stack, and what finds it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A suspended state machine is a <strong>heap object, not a stack frame</strong>, so
        <code>clrstack</code> and a debugger's thread list cannot see it. <code>dumpasync</code> in
        <code>dotnet-dump analyze</code> walks the heap and rebuilds the logical chain;
        <code>dumpasync --stats</code> groups by type to show where requests are piling up, and the
        state number tells you which <code>await</code> they are stuck on.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>async void</code> dangerous, and how does it appear without being written?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It has no Task, so it cannot be awaited and has nowhere to store an exception — which is
        rethrown on a pool thread and <strong>terminates the process</strong>. It appears whenever an
        async lambda is assigned to a void-returning delegate:
        <code>List&lt;T&gt;.ForEach</code>, <code>TimerCallback</code>, <code>Action</code>. CS4014
        does not catch it, because there is no Task being discarded. <strong>VSTHRD101</strong>
        does.</p>
      </div></details>
    </li>
    <li>
      <p>Where does an exception thrown on the first line of an async method surface?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>At whoever awaits the returned Task — which may be nowhere. The method returns a
        <strong>faulted Task rather than throwing</strong>, because <code>MoveNext</code> wraps the
        whole body in a try/catch feeding <code>builder.SetException</code>. Put argument validation
        in a non-async wrapper so it throws at the call site.</p>
      </div></details>
    </li>
    <li>
      <p>Why can memory grow with a dependency's latency when your own traffic has not changed?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Because anything hoisted is held for the whole duration of the suspension. Slower
        dependency means more concurrent in-flight operations, each holding its hoisted locals.
        Measured: 50 suspended operations held <strong>400 MB</strong> when an 8 MB buffer was read
        after the await, and <strong>0 MB</strong> when it was read before. One line moved.</p>
      </div></details>
    </li>
    <li>
      <p>Are async stack traces unreadable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — since .NET Core 2.1 exception traces show your method names and line numbers. What is
        genuinely gone is the <strong>physical</strong> stack: <code>new StackTrace()</code>, sampled
        profiles and <code>clrstack</code> see only the resuming pool frames. Never derive a caller
        from the runtime stack in async code; use <code>[CallerMemberName]</code> or an explicit
        correlation id.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
