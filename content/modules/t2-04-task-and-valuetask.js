CSPREP.module({
  id: "t2-04-task-and-valuetask",
  minutes: 55,
  updated: "2026-08-30",
  summary: "A Task is a promise object carrying an outcome, already running when you receive it and safe to await as many times as you like. ValueTask trades all of that safety for one thing — 80 bytes saved per call that completes synchronously — which makes it a bet on your hit rate, worth taking at 100% and actively negative at 0%.",
  terms: ["Task", "promise", "hot task", "cold task", "TaskStatus", "TaskCompletionSource",
    "ValueTask", "IValueTaskSource", "AsTask", "RunContinuationsAsynchronously",
    "Task.FromResult", "Task.CompletedTask", "AggregateException", "state machine"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p><a href="#/m/t2-03-what-async-really-is">What <code>async</code> Actually Is</a> established that
  an awaiting operation occupies no thread. That leaves a question it did not answer: if nothing is
  running and no thread is assigned, <strong>what exactly is the thing you are awaiting?</strong></p>

  <p>It has to be an object, because you can store it in a variable, pass it to a method, and put it
  in a list. It has to survive independently of any thread, because there is not one. And it has to
  carry an outcome that might be a value, a cancellation, or an exception that has not been thrown
  yet.</p>

  <p>That object is <code>Task</code>. Understanding it as an object rather than as "the async thing"
  answers several questions at once: why an exception surfaces at the <code>await</code> rather than
  where it was thrown, why awaiting the same task twice does not run anything twice, and why a method
  starts running before you await it.</p>

  <p>It also costs 80 bytes every time you call an async method, <strong>including when the method
  does not actually wait for anything</strong>. <code>ValueTask</code> exists for that case, and this
  module measures exactly when it is worth its considerable restrictions.</p>
</section>

<section id="what-a-task-is">
  <h2>What a Task is</h2>

  <p class="define"><span class="define__term">Task</span> An object representing the eventual outcome
  of an operation. It is not a thread and not the operation itself — it is the handle you hold while
  the operation happens elsewhere, or nowhere at all.
  <span class="define__term">Task&lt;T&gt;</span> the same with a result value.</p>

  <p class="define"><span class="define__term">TaskStatus</span> The state a Task is in.
  <code>WaitingForActivation</code> means nothing has completed it yet;
  <code>RanToCompletion</code>, <code>Faulted</code> and <code>Canceled</code> are the three ways
  it can finish. A task stuck in the first is waiting for something that is not happening, which is
  a different bug from one that faulted quietly.</p>

  <p class="define"><span class="define__term">Promise</span> The general name for this pattern: an
  object handed over immediately that will later contain an answer. JavaScript's
  <code>Promise</code> and Java's <code>CompletableFuture</code> are the same idea.</p>

  <p>The analogy: a Task is a <strong>cloakroom ticket</strong>. It is not your coat and not the
  cloakroom attendant — it is the thing you hold that lets you claim the outcome later.
  <strong>The analogy breaks usefully in two places</strong>: a ticket can be redeemed only once and a
  Task can be awaited any number of times, and a ticket does nothing if the cloakroom burns down
  whereas a Task carries the fire to you as an exception.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-a-task-is.cs"><code>// 01-what-a-task-is.cs — a Task is a promise object with a state machine of its
// own, not a thread and not an operation. Read from the running process.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-what-a-task-is.cs
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- a Task is an object describing an operation's OUTCOME ---");
        var running = Task.Delay(100);
        Console.WriteLine($"  type            : {running.GetType().Name}");
        Console.WriteLine($"  Status          : {running.Status}");
        Console.WriteLine($"  IsCompleted     : {running.IsCompleted}");
        running.Wait();
        Console.WriteLine($"  after waiting   : {running.Status}, IsCompleted={running.IsCompleted}");
        Console.WriteLine("  It is not a thread and not the operation. It is the handle you");
        Console.WriteLine("  hold while the operation happens somewhere else, or nowhere.");

        Console.WriteLine();
        Console.WriteLine("--- the states a Task passes through ---");
        Console.WriteLine($"  a completed task     : {Task.CompletedTask.Status}");
        Console.WriteLine($"  a result task        : {Task.FromResult(42).Status}");
        var cancelled = Task.FromCanceled(new CancellationToken(true));
        Console.WriteLine($"  a cancelled task     : {cancelled.Status}");
        var faulted = Task.FromException(new InvalidOperationException("boom"));
        Console.WriteLine($"  a faulted task       : {faulted.Status}");
        Console.WriteLine($"  faulted.Exception    : {faulted.Exception?.GetType().Name} " +
                          $"wrapping {faulted.Exception?.InnerException?.GetType().Name}");
        Console.WriteLine("  A Task carries the outcome — value, cancellation or exception —");
        Console.WriteLine("  which is why the exception surfaces when you await it, not when");
        Console.WriteLine("  the operation failed.");
        _ = faulted.Exception;   // observe it so the finaliser does not complain

        Console.WriteLine();
        Console.WriteLine("--- an already-completed task costs nothing to await ---");
        Console.WriteLine($"  Task.CompletedTask is a singleton : " +
                          $"{ReferenceEquals(Task.CompletedTask, Task.CompletedTask)}");
        Console.WriteLine($"  Task.FromResult(42) twice, same object : " +
                          $"{ReferenceEquals(Task.FromResult(42), Task.FromResult(42))}");
        Console.WriteLine("  CompletedTask is cached; FromResult generally is not, though the");
        Console.WriteLine("  runtime caches a few common values internally.");

        Console.WriteLine();
        Console.WriteLine("--- TaskCompletionSource: a Task you complete yourself ---");
        var tcs = new TaskCompletionSource&lt;string&gt;(TaskCreationOptions.RunContinuationsAsynchronously);
        Console.WriteLine($"  before                : {tcs.Task.Status}");
        var waiter = Task.Run(async () =&gt;
        {
            var value = await tcs.Task.ConfigureAwait(false);
            Console.WriteLine($"  a waiter received     : {value}");
        });
        Thread.Sleep(50);
        Console.WriteLine($"  while nobody has set it : {tcs.Task.Status}, and NO thread is");
        Console.WriteLine("  running the 'operation' — there is no operation. This is how you");
        Console.WriteLine("  turn a callback-based API into an awaitable one.");
        tcs.SetResult("done");
        waiter.Wait();
        Console.WriteLine($"  after SetResult       : {tcs.Task.Status}");

        Console.WriteLine();
        Console.WriteLine("--- a Task is hot: it is already running when you receive it ---");
        var sw = Stopwatch.StartNew();
        var started = SlowAsync();
        var afterCall = sw.Elapsed.TotalMilliseconds;
        Thread.Sleep(150);
        var beforeAwait = sw.Elapsed.TotalMilliseconds;
        started.Wait();
        Console.WriteLine($"  call returned after   : {afterCall:N0} ms");
        Console.WriteLine($"  slept 150 ms, then awaited; total : {sw.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine("  The 200 ms operation ran DURING the sleep. A Task is not a recipe");
        Console.WriteLine("  you trigger by awaiting — that is the opposite of IEnumerable,");
        Console.WriteLine("  where nothing happens until you enumerate.");

        Console.WriteLine();
        Console.WriteLine("--- awaiting the same Task twice is fine; the operation runs once ---");
        var once = CountedAsync();
        once.Wait();
        once.Wait();
        Console.WriteLine($"  awaited twice, body ran {_calls} time(s)");
        Console.WriteLine("  A Task holds a RESULT. Re-awaiting reads it again.");
    }

    static int _calls;

    static async Task SlowAsync() =&gt; await Task.Delay(200).ConfigureAwait(false);

    static async Task CountedAsync()
    {
        Interlocked.Increment(ref _calls);
        await Task.Delay(20).ConfigureAwait(false);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- a Task is an object describing an operation's OUTCOME ---
  type            : DelayPromise
  Status          : WaitingForActivation
  IsCompleted     : False
  after waiting   : RanToCompletion, IsCompleted=True
  It is not a thread and not the operation. It is the handle you
  hold while the operation happens somewhere else, or nowhere.

--- the states a Task passes through ---
  a completed task     : RanToCompletion
  a result task        : RanToCompletion
  a cancelled task     : Canceled
  a faulted task       : Faulted
  faulted.Exception    : AggregateException wrapping InvalidOperationException
  A Task carries the outcome — value, cancellation or exception —
  which is why the exception surfaces when you await it, not when
  the operation failed.

--- an already-completed task costs nothing to await ---
  Task.CompletedTask is a singleton : True
  Task.FromResult(42) twice, same object : False
  CompletedTask is cached; FromResult generally is not, though the
  runtime caches a few common values internally.

--- TaskCompletionSource: a Task you complete yourself ---
  before                : WaitingForActivation
  while nobody has set it : WaitingForActivation, and NO thread is
  running the 'operation' — there is no operation. This is how you
  turn a callback-based API into an awaitable one.
  a waiter received     : done
  after SetResult       : RanToCompletion

--- a Task is hot: it is already running when you receive it ---
  call returned after   : 1 ms
  slept 150 ms, then awaited; total : 229 ms
  The 200 ms operation ran DURING the sleep. A Task is not a recipe
  you trigger by awaiting — that is the opposite of IEnumerable,
  where nothing happens until you enumerate.

--- awaiting the same Task twice is fine; the operation runs once ---
  awaited twice, body ran 1 time(s)
  A Task holds a RESULT. Re-awaiting reads it again.</code></pre>

  <p class="define"><span class="define__term">Hot task</span> One that is already running when you
  receive it. Every Task from an async method or a framework API is hot.
  <span class="define__term">Cold task</span> one that starts only when triggered — which .NET
  effectively does not produce, and which you should never write.</p>

  <p><strong>The 200 ms operation ran during a 150 ms sleep.</strong> The call returned after 1 ms
  and the total was 229 ms, not 350. That is the opposite of
  <a href="#/m/t1-25-deferred-execution">a LINQ query</a>, where nothing happens until you enumerate,
  and it is worth holding the contrast: <em>a sequence is a recipe; a Task is an outcome already in
  progress</em>.</p>

  <p><strong>Awaiting twice ran the body once.</strong> A Task holds a result; re-awaiting reads it
  again. This is why a Task can be shared between callers and why caching one is a legitimate
  technique.</p>

  <p class="define"><span class="define__term">TaskCompletionSource</span> A Task you complete
  yourself, with <code>SetResult</code>, <code>SetException</code> or <code>SetCanceled</code>. There
  is no operation and no thread behind it — it is the tool for turning a callback-based API into an
  awaitable one.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>A faulted Task holds an <code>AggregateException</code>.</strong> Verified: the
    <code>Exception</code> property wrapped an <code>InvalidOperationException</code>. Awaiting the
    task unwraps it and throws the original, so <code>await</code> and <code>.Result</code> behave
    differently on failure — <code>.Result</code> throws the wrapper. That is one more reason
    <code>await</code> is not merely a nicer spelling of blocking.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — the module's minimal example, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs
#:property Nullable=enable

using System;
using System.Threading.Tasks;

class Program
{
    static async Task&lt;int&gt; AddAsync(int a, int b)
    {
        await Task.Delay(50);
        return a + b;
    }

    static async Task Main()
    {
        // The call returns a Task immediately. The work is already running.
        Task&lt;int&gt; pending = AddAsync(2, 3);

        Console.WriteLine($"before await : Status={pending.Status}, IsCompleted={pending.IsCompleted}");

        int result = await pending;

        Console.WriteLine($"after await  : Status={pending.Status}, Result={result}");
        Console.WriteLine($"awaited again: {await pending}   (the body did not run twice)");

        // A Task that has already failed carries the exception until observed.
        Task failed = Task.FromException(new InvalidOperationException("declined"));
        Console.WriteLine($"failed task  : Status={failed.Status}");
        try
        {
            await failed;
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"awaiting it  : threw {ex.GetType().Name}: {ex.Message}");
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>before await : Status=WaitingForActivation, IsCompleted=False
after await  : Status=RanToCompletion, Result=5
awaited again: 5   (the body did not run twice)
failed task  : Status=Faulted
awaiting it  : threw InvalidOperationException: declined</code></pre>

  <p>Five lines, and every claim in the previous section is visible in them.</p>

  <p><strong>The variable is declared <code>Task&lt;int&gt;</code>, not <code>int</code>.</strong>
  That is the whole shift: the method hands back a receipt rather than an answer, and
  <code>await</code> is how you turn one into the other.</p>

  <p><strong>Its status is <code>WaitingForActivation</code> before the await</strong> — the work
  is in flight, and nothing on any thread is executing it. After the await the same object reports
  <code>RanToCompletion</code> and holds the value.</p>

  <p><strong>Awaiting it a second time returned 5 without re-running anything.</strong> And the
  faulted task shows where an exception lives in this model: it sits in the Task, in the
  <code>Faulted</code> state, and is thrown at the <code>await</code> rather than at the point of
  failure.</p>
</section>

<section id="valuetask">
  <h2><code>ValueTask</code>: what it saves and what it costs</h2>

  <p class="define"><span class="define__term">ValueTask&lt;T&gt;</span> A struct that either holds a
  result directly or wraps a Task. When an async method completes without ever suspending, the struct
  carries the value and <strong>no object is allocated at all</strong>.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-valuetask.cs"><code>// 02-valuetask.cs — what ValueTask saves, when it saves nothing, and the four
// rules that make it dangerous. The allocation numbers are the whole argument.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-valuetask.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static readonly Dictionary&lt;string, decimal&gt; Cache = new()
    {
        ["GBP"] = 1.00m, ["EUR"] = 1.17m, ["USD"] = 1.27m
    };

    static long _sink;

    static void Main()
    {
        Console.WriteLine("--- the shape ValueTask exists for: a cache that usually hits ---");
        Console.WriteLine();
        Console.WriteLine("  A lookup that finds the value in memory has nothing to await, but");
        Console.WriteLine("  its signature must stay awaitable because sometimes it misses.");
        Console.WriteLine();

        const int N = 1_000_000;

        var taskAlloc = AllocPerCall(() =&gt; { _sink += GetRateTask("GBP").GetAwaiter().GetResult() &gt; 0 ? 1 : 0; });
        var valueAlloc = AllocPerCall(() =&gt; { _sink += GetRateValueTask("GBP").GetAwaiter().GetResult() &gt; 0 ? 1 : 0; });
        var syncAlloc = AllocPerCall(() =&gt; { _sink += GetRateSync("GBP") &gt; 0 ? 1 : 0; });

        Console.WriteLine("  ALL CACHE HITS (nothing suspends):");
        Console.WriteLine($"    plain synchronous method   : {syncAlloc,5} bytes/call");
        Console.WriteLine($"    Task&lt;decimal&gt;              : {taskAlloc,5} bytes/call");
        Console.WriteLine($"    ValueTask&lt;decimal&gt;         : {valueAlloc,5} bytes/call");
        Console.WriteLine();
        Console.WriteLine($"  At {N:N0} calls/second that is " +
                          $"{taskAlloc * (long)N / 1024 / 1024:N0} MB/s of garbage against " +
                          $"{valueAlloc * (long)N / 1024 / 1024:N0} MB/s.");

        Console.WriteLine();
        Console.WriteLine("--- and when it actually suspends, the saving disappears ---");
        var taskMiss = AllocPerCall(() =&gt; { _sink += GetRateTask("JPY").GetAwaiter().GetResult() &gt; 0 ? 1 : 0; });
        var valueMiss = AllocPerCall(() =&gt; { _sink += GetRateValueTask("JPY").GetAwaiter().GetResult() &gt; 0 ? 1 : 0; });
        Console.WriteLine("  ALL CACHE MISSES (every call awaits):");
        Console.WriteLine($"    Task&lt;decimal&gt;              : {taskMiss,5} bytes/call");
        Console.WriteLine($"    ValueTask&lt;decimal&gt;         : {valueMiss,5} bytes/call");
        Console.WriteLine("  A ValueTask that has to suspend allocates the state machine anyway,");
        Console.WriteLine("  and boxes itself on top. It is WORSE than Task on this path.");
        Console.WriteLine("  The whole bet is that the synchronous path dominates.");

        Console.WriteLine();
        Console.WriteLine("--- speed, not only allocation ---");
        var tTask = Time(() =&gt; { for (var i = 0; i &lt; 200_000; i++) _sink += GetRateTask("GBP").GetAwaiter().GetResult() &gt; 0 ? 1 : 0; });
        var tValue = Time(() =&gt; { for (var i = 0; i &lt; 200_000; i++) _sink += GetRateValueTask("GBP").GetAwaiter().GetResult() &gt; 0 ? 1 : 0; });
        Console.WriteLine($"  200,000 cache hits via Task      : {tTask,6:N0} ms");
        Console.WriteLine($"  200,000 cache hits via ValueTask : {tValue,6:N0} ms  ({tTask / tValue:N2}x)");

        Console.WriteLine();
        Console.WriteLine("=== the rules, demonstrated ===");

        Console.WriteLine();
        Console.WriteLine("--- rule 1: await it ONCE ---");
        var vt = GetRateValueTask("JPY");
        var first = vt.GetAwaiter().GetResult();
        Console.WriteLine($"  first await  : {first}");
        try
        {
            var second = vt.GetAwaiter().GetResult();
            Console.WriteLine($"  second await : {second}  (happened to work — see below)");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  second await : {ex.GetType().Name}");
        }
        Console.WriteLine("  A ValueTask backed by a POOLED IValueTaskSource may have been");
        Console.WriteLine("  recycled and now represent a different operation. Whether it");
        Console.WriteLine("  throws, returns a stale value, or returns someone else's value");
        Console.WriteLine("  depends on the implementation — which is exactly why the rule is");
        Console.WriteLine("  'once', not 'once unless it seems fine'.");

        Console.WriteLine();
        Console.WriteLine("--- rule 2: do not block on it ---");
        Console.WriteLine("  ValueTask has no .Wait(), and .Result on an incomplete one is");
        Console.WriteLine("  undefined rather than blocking. To block safely you must convert:");
        var converted = GetRateValueTask("JPY").AsTask();
        Console.WriteLine($"  AsTask().Result : {converted.Result}");
        Console.WriteLine("  AsTask() allocates the Task you were avoiding — correct, and it");
        Console.WriteLine("  means blocking on a ValueTask costs more than using Task would.");

        Console.WriteLine();
        Console.WriteLine("--- rule 3: do not await it concurrently ---");
        Console.WriteLine("  Two threads awaiting one ValueTask is a data race on the backing");
        Console.WriteLine("  source. Task supports this; ValueTask does not. If you need to");
        Console.WriteLine("  hand the same pending operation to several consumers, use Task.");

        Console.WriteLine();
        Console.WriteLine("--- rule 4: store the RESULT, never the ValueTask ---");
        Console.WriteLine("  A field of type ValueTask&lt;T&gt; outlives the safe window by design.");
        Console.WriteLine("  Await it immediately and keep the value, or call AsTask().");

        Console.WriteLine();
        Console.WriteLine("--- Task supports everything ValueTask forbids ---");
        var shared = GetRateTask("JPY");
        var a = shared.GetAwaiter().GetResult();
        var b = shared.GetAwaiter().GetResult();
        var c = shared.Result;
        Console.WriteLine($"  awaited three times : {a}, {b}, {c}  — all fine");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static decimal GetRateSync(string currency)
        =&gt; Cache.TryGetValue(currency, out var rate) ? rate : 0.5m;

    static async Task&lt;decimal&gt; GetRateTask(string currency)
    {
        if (Cache.TryGetValue(currency, out var rate)) return rate;
        await Task.Yield();                     // stands in for a real lookup
        return 0.5m;
    }

    static async ValueTask&lt;decimal&gt; GetRateValueTask(string currency)
    {
        if (Cache.TryGetValue(currency, out var rate)) return rate;
        await Task.Yield();
        return 0.5m;
    }

    static long AllocPerCall(Action a)
    {
        for (var i = 0; i &lt; 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        const int Reps = 10_000;
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i &lt; Reps; i++) a();
        var after = GC.GetAllocatedBytesForCurrentThread();
        return (after - before) / Reps;
    }

    static double Time(Action a)
    {
        a();
        var sw = Stopwatch.StartNew();
        a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the shape ValueTask exists for: a cache that usually hits ---

  A lookup that finds the value in memory has nothing to await, but
  its signature must stay awaitable because sometimes it misses.

  ALL CACHE HITS (nothing suspends):
    plain synchronous method   :     0 bytes/call
    Task&lt;decimal&gt;              :    80 bytes/call
    ValueTask&lt;decimal&gt;         :     0 bytes/call

  At 1,000,000 calls/second that is 76 MB/s of garbage against 0 MB/s.

--- and when it actually suspends, the saving disappears ---
  ALL CACHE MISSES (every call awaits):
    Task&lt;decimal&gt;              :   112 bytes/call
    ValueTask&lt;decimal&gt;         :   128 bytes/call
  A ValueTask that has to suspend allocates the state machine anyway,
  and boxes itself on top. It is WORSE than Task on this path.
  The whole bet is that the synchronous path dominates.

--- speed, not only allocation ---
  200,000 cache hits via Task      :     23 ms
  200,000 cache hits via ValueTask :     20 ms  (1.14x)

=== the rules, demonstrated ===

--- rule 1: await it ONCE ---
  first await  : 0.5
  second await : 0.5  (happened to work — see below)
  A ValueTask backed by a POOLED IValueTaskSource may have been
  recycled and now represent a different operation. Whether it
  throws, returns a stale value, or returns someone else's value
  depends on the implementation — which is exactly why the rule is
  'once', not 'once unless it seems fine'.

--- rule 2: do not block on it ---
  ValueTask has no .Wait(), and .Result on an incomplete one is
  undefined rather than blocking. To block safely you must convert:
  AsTask().Result : 0.5
  AsTask() allocates the Task you were avoiding — correct, and it
  means blocking on a ValueTask costs more than using Task would.

--- rule 3: do not await it concurrently ---
  Two threads awaiting one ValueTask is a data race on the backing
  source. Task supports this; ValueTask does not. If you need to
  hand the same pending operation to several consumers, use Task.

--- rule 4: store the RESULT, never the ValueTask ---
  A field of type ValueTask&lt;T&gt; outlives the safe window by design.
  Await it immediately and keep the value, or call AsTask().

--- Task supports everything ValueTask forbids ---
  awaited three times : 0.5, 0.5, 0.5  — all fine
  (checksum 855000)</code></pre>

  <p><strong>80 bytes against 0 on the synchronous path.</strong> At a million calls a second that
  is <strong>76 MB/s of garbage against none</strong>, which is the entire case for the type.</p>

  <p><strong>And 112 against 128 on the asynchronous path.</strong> A <code>ValueTask</code> that
  suspends allocates the state machine anyway and boxes itself on top — it is <em>worse</em> than
  <code>Task</code> there. The type is a bet on the synchronous path dominating, and a bet you lose
  if it does not.</p>

  <p class="define"><span class="define__term">IValueTaskSource</span> The interface a
  <code>ValueTask</code> can be backed by instead of a Task, so that a pooled object serves many
  operations in turn. It is what makes zero-allocation asynchronous completion possible, and it is
  the reason the consumption rules exist: the object under your <code>ValueTask</code> may be
  recycled the moment you read the result.</p>

  <p class="define"><span class="define__term">AsTask</span> Converts a <code>ValueTask</code> into
  a real <code>Task</code>, allocating one. It lifts all four restrictions at exactly the cost the
  type existed to avoid, which makes needing it a signal that <code>Task</code> was the right
  return type.</p>

  <h3>The four rules</h3>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Rule</th><th>Why</th><th><code>Task</code></th></tr></thead>
    <tbody>
      <tr><td><strong>Await it once</strong></td>
          <td>A pooled backing source may have been recycled and now represent someone else's
          operation.</td><td>Any number of times.</td></tr>
      <tr><td><strong>Do not block on it</strong></td>
          <td>No <code>Wait()</code>; <code>.Result</code> on an incomplete one is undefined rather
          than blocking.</td><td><code>.Wait()</code> and <code>.Result</code> both block.</td></tr>
      <tr><td><strong>Do not await it concurrently</strong></td>
          <td>Two consumers on one backing source is a data race.</td>
          <td>Safe from any number of threads.</td></tr>
      <tr><td><strong>Store the result, not the ValueTask</strong></td>
          <td>A field outlives the safe window by construction.</td>
          <td>Safe to store indefinitely.</td></tr>
    </tbody>
  </table>
  </div>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Rule 1 measured as "it worked", and that is the danger.</strong> Awaiting the same
    <code>ValueTask</code> twice returned the correct value both times — because this one is backed
    by a plain Task rather than a pooled <code>IValueTaskSource</code>. Change the implementation
    behind an interface, or upgrade a library, and the same calling code silently starts reading
    another operation's result. <strong>The rule is "once", not "once unless it seems fine"</strong>,
    precisely because the failure is invisible in testing.</p>
  </div>

  <p>Note what rule 2 implies: <code>AsTask()</code> allocates the Task you were avoiding, so
  <em>blocking on a <code>ValueTask</code> costs more than using <code>Task</code> would have</em>.
  If a caller might block, the type is already the wrong choice.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — Ledger's rate cache, the exact shape ValueTask was designed
// for, with the decision made on measurements rather than on reputation. Plus
// TaskCompletionSource wrapping a callback API, which is the other half of what
// Task is actually for.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Rates;

public sealed record Rate(string Currency, decimal PerGbp);

/// &lt;summary&gt;A rate cache. Hits are in-memory; misses go to a remote service.&lt;/summary&gt;
public sealed class RateCache
{
    private readonly ConcurrentDictionary&lt;string, Rate&gt; _cache = new();
    private readonly int _missMs;

    public RateCache(int missMs) =&gt; _missMs = missMs;

    public void Seed(params string[] currencies)
    {
        foreach (var c in currencies) _cache[c] = new Rate(c, 1.17m);
    }

    public int Count =&gt; _cache.Count;

    /// &lt;summary&gt;Task version: allocates on every call, hit or miss.&lt;/summary&gt;
    public async Task&lt;Rate&gt; GetTaskAsync(string currency, CancellationToken ct = default)
    {
        if (_cache.TryGetValue(currency, out var hit)) return hit;
        await Task.Delay(_missMs, ct).ConfigureAwait(false);
        var fetched = new Rate(currency, 1.00m);
        _cache[currency] = fetched;
        return fetched;
    }

    /// &lt;summary&gt;ValueTask version: allocates nothing on the hit path.&lt;/summary&gt;
    public ValueTask&lt;Rate&gt; GetValueTaskAsync(string currency, CancellationToken ct = default)
    {
        if (_cache.TryGetValue(currency, out var hit)) return new ValueTask&lt;Rate&gt;(hit);
        return new ValueTask&lt;Rate&gt;(FetchAsync(currency, ct));

        async Task&lt;Rate&gt; FetchAsync(string c, CancellationToken token)
        {
            await Task.Delay(_missMs, token).ConfigureAwait(false);
            var fetched = new Rate(c, 1.00m);
            _cache[c] = fetched;
            return fetched;
        }
    }
}

/// &lt;summary&gt;A callback-based API, of the kind TaskCompletionSource exists to wrap.&lt;/summary&gt;
public sealed class LegacyGateway
{
    public void Authorise(string reference, Action&lt;string&gt; onSuccess, Action&lt;Exception&gt; onError)
    {
        ThreadPool.QueueUserWorkItem(_ =&gt;
        {
            Thread.Sleep(30);
            if (reference.StartsWith("BAD", StringComparison.Ordinal))
                onError(new InvalidOperationException($"declined: {reference}"));
            else
                onSuccess("AUTH-" + reference);
        });
    }
}

public static class LegacyGatewayExtensions
{
    /// &lt;summary&gt;Turns the callback API into an awaitable one. No thread is held.&lt;/summary&gt;
    public static Task&lt;string&gt; AuthoriseAsync(this LegacyGateway gateway, string reference,
                                              CancellationToken ct = default)
    {
        var tcs = new TaskCompletionSource&lt;string&gt;(TaskCreationOptions.RunContinuationsAsynchronously);
        var registration = ct.Register(() =&gt; tcs.TrySetCanceled(ct));

        gateway.Authorise(reference,
            result =&gt; { registration.Dispose(); tcs.TrySetResult(result); },
            error =&gt; { registration.Dispose(); tcs.TrySetException(error); });

        return tcs.Task;
    }
}

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the decision: what is the hit rate? ===");
        Console.WriteLine();
        Console.WriteLine("  hit rate   Task bytes/call   ValueTask bytes/call   saving");

        foreach (var hitRate in new[] { 100, 99, 90, 50, 0 })
        {
            var cache = new RateCache(missMs: 1);
            var currencies = BuildWorkload(hitRate, cache);

            var taskBytes = AllocPerCall(currencies, c =&gt;
                _sink += cache.GetTaskAsync(c).GetAwaiter().GetResult().PerGbp &gt; 0 ? 1 : 0);

            var cache2 = new RateCache(missMs: 1);
            var currencies2 = BuildWorkload(hitRate, cache2);
            var valueBytes = AllocPerCall(currencies2, c =&gt;
                _sink += cache2.GetValueTaskAsync(c).GetAwaiter().GetResult().PerGbp &gt; 0 ? 1 : 0);

            Console.WriteLine($"  {hitRate,7}%   {taskBytes,15}   {valueBytes,20}   " +
                              $"{(taskBytes == 0 ? 0 : 100 - valueBytes * 100 / Math.Max(taskBytes, 1)),5}%");
        }

        Console.WriteLine();
        Console.WriteLine("  The saving is large at high hit rates and decays to nothing at 0%.");
        Console.WriteLine("  (In 02-valuetask.cs, where every call suspends, it goes further and");
        Console.WriteLine("  turns NEGATIVE: 128 bytes against Task's 112.)");
        Console.WriteLine("  ValueTask is a bet on the synchronous path, and if you cannot");
        Console.WriteLine("  say what your hit rate is, you cannot say whether it pays.");

        Console.WriteLine();
        Console.WriteLine("=== wrapping a callback API with TaskCompletionSource ===");
        var gateway = new LegacyGateway();

        var ok = gateway.AuthoriseAsync("P-1").GetAwaiter().GetResult();
        Console.WriteLine($"  success  : {ok}");

        try
        {
            gateway.AuthoriseAsync("BAD-2").GetAwaiter().GetResult();
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  failure  : {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine("  The exception arrived at the AWAIT, not at the callback. That");
            Console.WriteLine("  is what TaskCompletionSource buys: ordinary error handling.");
        }

        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            try
            {
                gateway.AuthoriseAsync("P-3", cts.Token).GetAwaiter().GetResult();
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine("  cancelled: OperationCanceledException");
            }
        }

        Console.WriteLine();
        Console.WriteLine("  Note RunContinuationsAsynchronously in the constructor. Without it,");
        Console.WriteLine("  the continuation runs INLINE on whichever thread called SetResult —");
        Console.WriteLine("  here, the gateway's own callback thread. A slow continuation would");
        Console.WriteLine("  then block the gateway's internals, and a deadlock is possible if");
        Console.WriteLine("  that thread holds a lock the continuation needs.");
        Console.WriteLine("  It is the single most commonly omitted argument in .NET.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static string[] BuildWorkload(int hitRatePercent, RateCache cache)
    {
        cache.Seed("GBP");
        var workload = new string[100];
        for (var i = 0; i &lt; 100; i++)
            workload[i] = i &lt; hitRatePercent ? "GBP" : $"X{i:D3}";
        return workload;
    }

    static long AllocPerCall(string[] workload, Action&lt;string&gt; call)
    {
        foreach (var c in workload) call(c);          // warm up and populate misses
        GC.Collect();
        GC.WaitForPendingFinalizers();

        var fresh = new string[workload.Length];
        for (var i = 0; i &lt; workload.Length; i++)
            fresh[i] = workload[i] == "GBP" ? "GBP" : $"Y{i:D3}";

        var before = GC.GetAllocatedBytesForCurrentThread();
        foreach (var c in fresh) call(c);
        var after = GC.GetAllocatedBytesForCurrentThread();
        return (after - before) / fresh.Length;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>=== the decision: what is the hit rate? ===

  hit rate   Task bytes/call   ValueTask bytes/call   saving
      100%                72                      0     100%
       99%                74                      3      96%
       90%               100                     36      64%
       50%               216                    180      17%
        0%               360                    360       0%

  The saving is large at high hit rates and decays to nothing at 0%.
  (In 02-valuetask.cs, where every call suspends, it goes further and
  turns NEGATIVE: 128 bytes against Task's 112.)
  ValueTask is a bet on the synchronous path, and if you cannot
  say what your hit rate is, you cannot say whether it pays.

=== wrapping a callback API with TaskCompletionSource ===
  success  : AUTH-P-1
  failure  : InvalidOperationException: declined: BAD-2
  The exception arrived at the AWAIT, not at the callback. That
  is what TaskCompletionSource buys: ordinary error handling.
  cancelled: OperationCanceledException

  Note RunContinuationsAsynchronously in the constructor. Without it,
  the continuation runs INLINE on whichever thread called SetResult —
  here, the gateway's own callback thread. A slow continuation would
  then block the gateway's internals, and a deadlock is possible if
  that thread holds a lock the continuation needs.
  It is the single most commonly omitted argument in .NET.
  (checksum 2000)</code></pre>

  <p><strong>The decision is a number, and it is your cache hit rate.</strong> 100% saves everything,
  90% saves 64%, 50% saves 17%, and 0% saves nothing at all. If you cannot state your hit rate, you
  cannot state whether the restrictions are worth accepting.</p>

  <p>Notice how the <code>ValueTask</code> version is written. The fast path returns
  <code>new ValueTask&lt;Rate&gt;(hit)</code> — a struct wrapping a value, no async machinery — and
  the slow path delegates to a private <code>async Task</code> local function. <strong>The outer
  method is not itself <code>async</code></strong>, which is what keeps the hit path free of a state
  machine.</p>

  <h3>The other half of what Task is for</h3>

  <p>The <code>TaskCompletionSource</code> wrapper turns a callback API into an awaitable one, and it
  is worth reading closely because it does three things at once: the success callback becomes a
  return value, the error callback becomes <strong>an exception thrown at the
  <code>await</code></strong>, and a <code>CancellationToken</code> registration becomes
  cancellation.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong><code>RunContinuationsAsynchronously</code> is the most commonly omitted argument in
    .NET.</strong> Without it, everything awaiting that task runs <em>inline on whichever thread
    called <code>SetResult</code></em> — measured in the exercises as the same thread id. That thread
    belongs to the library that invoked your callback. A slow continuation blocks its internals, and
    if it holds a lock your continuation needs, the result is a deadlock in someone else's code.
    Pass the flag unless you have a specific reason not to.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. <code>ValueTask</code> as a default return type</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: all of the restrictions, none of the benefit"><code>// WRONG. This always suspends, so it never takes the fast path. Measured on a
// path that always awaits: ValueTask 128 bytes/call against Task's 112 — worse,
// plus four consumption rules the callers now have to obey.
public async ValueTask&lt;Rate&gt; FetchAsync(string currency, CancellationToken ct)
{
    var response = await _http.GetAsync($"/rates/{currency}", ct);
    return await response.Content.ReadFromJsonAsync&lt;Rate&gt;(ct);
}

// Right: it always awaits, so Task is both cheaper and safer.
public async Task&lt;Rate&gt; FetchAsync(string currency, CancellationToken ct) { … }</code></pre>

  <h3>2. Awaiting a <code>ValueTask</code> twice</h3>

  <p>Measured: it worked, which is the problem. With a pooled backing source it reads another
  operation's result instead, and nothing in the calling code changes to reveal it.</p>

  <h3>3. Blocking on a <code>ValueTask</code></h3>

  <p><code>AsTask().Result</code> allocates the Task you were avoiding, so it costs more than
  <code>Task</code> would have. If callers block, do not use <code>ValueTask</code>.</p>

  <h3>4. Omitting <code>RunContinuationsAsynchronously</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: your continuation runs on someone else's thread"><code>// WRONG. Every continuation runs inline on whichever thread calls SetResult —
// measured as the same thread id. That is a library's internal callback thread,
// and blocking it can deadlock code you do not own.
var tcs = new TaskCompletionSource&lt;string&gt;();

// Right.
var tcs = new TaskCompletionSource&lt;string&gt;(
    TaskCreationOptions.RunContinuationsAsynchronously);</code></pre>

  <h3>5. Hoisting a <code>ValueTask</code> out of the call site</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: works on the fast path, fails on the slow one"><code>// WRONG. This is the refactor that caused the incident below. It looks like a
// harmless hoist, and it awaits one ValueTask twice.
var pending = _cache.GetRateAsync(currency);        // ValueTask&lt;Rate&gt;
if (invoice.IsDomestic)
    total = invoice.Amount * (await pending).PerGbp;
else
    total = invoice.Amount * (await pending).PerGbp * surcharge;   // second await

// Right, if you must hoist: convert once.
var pending = _cache.GetRateAsync(currency).AsTask();

// Better: await once, keep the value.
var rate = await _cache.GetRateAsync(currency);</code></pre>

  <p>On a cache hit the <code>ValueTask</code> holds a plain value and both awaits succeed — which
  is what every test with a warm cache sees. On a miss it wraps a real Task and the second await
  throws.</p>

  <h3>6. <code>async Task</code> for a method that never awaits</h3>

  <p>Measured at 80 bytes per call for nothing. Return <code>Task.FromResult</code> or
  <code>Task.CompletedTask</code> instead, or drop the async signature entirely.</p>

  <h3>7. Treating <code>.Result</code> and <code>await</code> as interchangeable on failure</h3>

  <p><code>await</code> throws the original exception; <code>.Result</code> throws an
  <code>AggregateException</code> wrapping it — verified. A <code>catch</code> written for one will
  miss the other.</p>

  <h3>8. Expecting a Task to be lazy</h3>

  <p>Measured: a 200 ms operation completed during an unrelated 150 ms sleep, before it was awaited.
  Creating a Task starts the work, so "build a list of tasks and await them later" has already
  started all of them — which is usually what you want and occasionally a stampede.</p>

  <h3>9. <code>TaskCompletionSource&lt;T&gt;</code> with <code>SetResult</code> instead of
  <code>TrySetResult</code></h3>

  <p>A callback that fires twice, or a race between completion and cancellation, throws
  <code>InvalidOperationException</code> on the second call — on a thread with no handler. The
  <code>Try</code> variants return <code>false</code> instead, which is nearly always what you
  want.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Deciding whether <code>ValueTask</code> is worth it.</strong> Measure the fraction of
    calls that complete without suspending — a counter incremented on the fast path is enough. Above
    about 90% it saves most of the allocation; at 50% it saves 17%; below that the restrictions cost
    more than the bytes.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>An operation returns a result belonging to a different request.</strong> Suspect a
    <code>ValueTask</code> awaited twice, stored in a field, or shared between consumers. Search for
    <code>ValueTask</code> in field declarations and for any awaited more than once — the compiler
    will not warn, but the <code>Microsoft.VisualStudio.Threading.Analyzers</code> package flags some
    of these.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A deadlock inside a third-party library.</strong> Look for a
    <code>TaskCompletionSource</code> without
    <code>RunContinuationsAsynchronously</code>. Your continuation is running on their callback
    thread, and if it blocks on something that thread is also required for, neither proceeds.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Allocation profiling points at <code>AsyncTaskMethodBuilder</code>.</strong> That is
    the state machine and Task for async methods, at roughly 80–112 bytes a call. If those calls
    usually complete synchronously, <code>ValueTask</code> is the fix. If they always suspend, the
    allocation is the cost of the operation and not worth attacking.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A task that never completes.</strong> If it came from a
    <code>TaskCompletionSource</code>, some path fails to call any of the <code>Set</code> methods —
    an exception before the callback is registered, or an error path with no
    <code>TrySetException</code>. Every exit from the wrapped API must complete the source, and
    <code>ct.Register</code> is what covers the cancellation exit.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Reading a Task's state in a debugger.</strong> <code>Status</code> distinguishes
    <code>WaitingForActivation</code> (nobody has completed it) from <code>RanToCompletion</code>,
    <code>Faulted</code> and <code>Canceled</code>. A task stuck in
    <code>WaitingForActivation</code> is waiting for something that is not happening — which is a
    different problem from one that faulted and had its exception swallowed.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's currency-rate cache was called on every line of
    every invoice — roughly 400,000 times a second at peak across the fleet, with a hit rate above
    99% because rates change a few times a day.</p>
    <p>It returned <code>Task&lt;Rate&gt;</code>. At the 80 bytes measured above, that is about
    <strong>30 MB/s of allocation</strong> for values that were already in memory. The symptom was
    not latency — it was gen-0 collections running constantly, and a p99 with a sawtooth that
    tracked them.</p>
    <p>Changing the signature to <code>ValueTask&lt;Rate&gt;</code>, with the fast path returning a
    struct and only the miss path going async, took the hit-path allocation to <strong>zero</strong>.
    Gen-0 frequency dropped by about a third and the sawtooth went with it.</p>
    <p><strong>Then it caused an incident three months later.</strong> A new endpoint needed the rate
    twice in one method and, reasonably, wrote
    <code>var rate = await _cache.GetAsync(c); … var again = await _cache.GetAsync(c);</code> — which
    is fine. What was not fine was a refactor that hoisted the call:
    <code>var pending = _cache.GetAsync(c);</code> followed by two <code>await pending</code> in
    different branches.</p>
    <p>In testing every call was a cache hit, the <code>ValueTask</code> held a plain value, and
    awaiting twice worked — exactly as measured above. In production the first request after a rate
    refresh was a miss, the <code>ValueTask</code> wrapped a real Task, and the second await
    threw <code>InvalidOperationException</code> on roughly one request in fifty thousand.</p>
    <p>It took a week, because the failure rate was low enough to look like noise and the stack trace
    pointed at the second <code>await</code> rather than at the hoisting. The fix was one line —
    <code>.AsTask()</code> at the hoist — and the durable fix was an analyser rule plus a comment on
    the method explaining why its return type has rules.</p>
  </div>

  <p>The general principle: <strong><code>ValueTask</code> trades safety for allocation, and the
  trade is only worth making where the allocation is measurably hurting you.</strong> 30 MB/s of
  garbage is a real problem worth solving. A method called a thousand times a second is not, and
  paying four consumption rules for 80 KB/s is a bad exchange.</p>

  <p>What makes it genuinely dangerous is that the restrictions are <em>invisible in testing</em>.
  Every rule violation above works correctly when the fast path is taken, and the fast path is what
  a unit test with a warm cache always takes. The bug ships because the test suite cannot see
  it.</p>

  <p>So the honest rule is narrower than "use <code>ValueTask</code> in hot paths". It is:
  <strong>use it where you have measured a real allocation problem, on a method whose callers you
  control, and document why.</strong> Everywhere else, <code>Task</code> — which is safe to await
  twice, safe to store, safe to share, and costs 80 bytes.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A Task is a thread."</strong> It is an object holding an outcome. Verified: a
    <code>TaskCompletionSource</code> task sat in <code>WaitingForActivation</code> with no thread
    anywhere running an operation, because there was no operation.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A Task starts when you await it."</strong> It is already running. Measured: a 200 ms
    operation completed during an unrelated 150 ms sleep, and awaiting afterwards returned
    immediately — total 229 ms, not 350.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Awaiting a Task twice runs it twice."</strong> Verified: the body ran once. A Task
    holds a result, and re-awaiting reads it again.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>ValueTask</code> is a faster <code>Task</code>."</strong> Only when the
    operation completes synchronously. Measured on a path that always suspends:
    <strong>128 bytes against <code>Task</code>'s 112</strong> — worse, plus four rules.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I tested awaiting the <code>ValueTask</code> twice and it worked."</strong> It did —
    measured. It works whenever the fast path is taken, which is what a test with a warm cache always
    does. That is why this rule is stated absolutely.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>.Result</code> and <code>await</code> throw the same thing."</strong>
    <code>await</code> throws the original exception; <code>.Result</code> throws an
    <code>AggregateException</code> wrapping it — verified on a faulted task.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>async Task</code> on a method that returns immediately is free."</strong>
    Measured at <strong>80 bytes per call</strong>. The compiler must produce a Task before it knows
    whether the method will suspend.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Return</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>Anything, by default</td><td><code>Task</code> / <code>Task&lt;T&gt;</code></td>
          <td>Safe to await twice, store, and share. 80 bytes.</td></tr>
      <tr><td>A hot path that usually completes synchronously, measured</td>
          <td><code>ValueTask&lt;T&gt;</code></td>
          <td>0 bytes on the fast path; 76 MB/s saved at a million calls a second.</td></tr>
      <tr><td>A method that always awaits</td><td><code>Task</code></td>
          <td><code>ValueTask</code> measured <em>worse</em> there: 128 against 112.</td></tr>
      <tr><td>Callers might block on it</td><td><code>Task</code></td>
          <td><code>AsTask().Result</code> allocates what you were saving.</td></tr>
      <tr><td>The result is shared between consumers</td><td><code>Task</code></td>
          <td>Concurrent awaits are a data race on a <code>ValueTask</code>.</td></tr>
      <tr><td>A method with nothing to await</td>
          <td><code>Task.FromResult</code> / <code>Task.CompletedTask</code></td>
          <td>Avoids the state machine; <code>CompletedTask</code> is a cached singleton.</td></tr>
      <tr><td>Wrapping a callback or event API</td><td><code>TaskCompletionSource&lt;T&gt;</code>,
          returning <code>Task</code></td>
          <td>Turns callbacks into a return value and errors into exceptions at the
          <code>await</code>.</td></tr>
      <tr><td>Any <code>TaskCompletionSource</code></td>
          <td><code>RunContinuationsAsynchronously</code>, and the <code>Try</code>
          setters</td>
          <td>Otherwise continuations run on someone else's thread, and a double callback
          throws.</td></tr>
      <tr><td>You must hold a <code>ValueTask</code> beyond one await</td>
          <td><code>.AsTask()</code> immediately</td>
          <td>Converts once, safely, at the cost you were avoiding.</td></tr>
    </tbody>
  </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>An async method's body increments a counter and then delays 150 ms. You call it, sleep 200 ms,
    then await it — twice. How many times does the body run, and what is the total elapsed time?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>body ran before the call returned : 1 time(s)
call returned after               : 10 ms
slept 200 ms, then awaited
total                             : 247 ms
not 200 + 150 = 350 — the 150 ms operation ran DURING the sleep,
so awaiting it afterwards returned immediately.
awaited a second time; body ran   : 1 time(s) total</code></pre>
        <p><strong>The body ran once, before the call even returned</strong>, and the total was 247
        ms rather than 350.</p>
        <p><strong>Two facts are doing all the work here.</strong></p>
        <p><strong>A Task is hot.</strong> Calling the method starts it. The body ran synchronously up
        to the first <code>await</code>, then the method returned a Task representing the rest. By
        the time the 200 ms sleep finished, the 150 ms delay was long done, so awaiting cost
        nothing.</p>
        <p><strong>A Task holds a result, not a recipe.</strong> The second await read the same
        completed outcome. Contrast
        <a href="#/m/t1-25-deferred-execution">a LINQ query</a>, where enumerating twice runs
        everything twice — that is the opposite design, and confusing the two is common.</p>
        <p><strong>Why it matters practically:</strong> <code>var tasks = items.Select(i =&gt;
        ProcessAsync(i)).ToList();</code> has already started every operation by the time
        <code>ToList</code> returns. If <code>items</code> has 10,000 entries, you have thereby made
        10,000 concurrent requests, and no <code>await</code> has been written yet.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Four ways to return a value that is already in memory. Predict the allocation per call for
    each.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>static decimal Sync() =&gt; 1;
static async Task&lt;decimal&gt; Tsk() { await Task.CompletedTask; return 1; }
static async ValueTask&lt;decimal&gt; Vt() { await Task.CompletedTask; return 1; }
static Task&lt;decimal&gt; FromResult() =&gt; Task.FromResult(1m);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>decimal (plain)      :    0 bytes/call
Task&lt;decimal&gt;        :   80 bytes/call
ValueTask&lt;decimal&gt;   :    0 bytes/call
Task.FromResult      :   80 bytes/call</code></pre>
        <p><strong>The two zeros and the two eighties are the whole lesson.</strong></p>
        <p><strong><code>async Task</code> allocates 80 bytes even though nothing suspends.</strong>
        <code>await Task.CompletedTask</code> completes immediately, so no state machine is ever
        parked — but the compiler cannot know that in advance. It must produce a
        <code>Task&lt;decimal&gt;</code> to return before it discovers the method finished
        synchronously.</p>
        <p><strong><code>async ValueTask</code> allocates nothing</strong> on that path, because a
        struct carrying a <code>decimal</code> needs no heap object at all. This is the entire
        feature.</p>
        <p><strong><code>Task.FromResult</code> still allocates 80 bytes</strong>, which surprises
        people who reach for it as an optimisation. It skips the <em>state machine</em> but still
        creates a <code>Task&lt;decimal&gt;</code> object. The runtime caches tasks for a few common
        values — <code>true</code>, <code>false</code>, small <code>int</code>s — but not for an
        arbitrary <code>decimal</code>.</p>
        <p><strong>The practical ordering:</strong> if the method genuinely has nothing async about
        it, the best return type is <code>decimal</code>. If an interface forces an awaitable
        signature, <code>ValueTask&lt;T&gt;</code> is the only one of these that is free — and it
        brings four rules with it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Which of these are safe with <code>Task</code>, and which with <code>ValueTask</code>?
    (a) awaiting twice, (b) storing in a field and awaiting later, (c) two threads awaiting the same
    instance.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>(a) awaiting the same Task twice
    1, 1 — SAFE
(b) storing a Task in a field and awaiting it later
    1 — SAFE
(c) two threads awaiting the same Task
    both got 1 and 1 — SAFE
(d) the same three things with a ValueTask
    NOT SAFE — await once, never store, never share.
    Converting first makes them safe again:
    AsTask() then await twice : 1, 1
    ...at the cost of the allocation ValueTask was avoiding.</code></pre>
        <p><strong>All three are safe with <code>Task</code>; none are safe with
        <code>ValueTask</code>.</strong></p>
        <p><strong>Why <code>Task</code> can do all of it.</strong> It is an immutable outcome once
        completed. Awaiting reads a field; there is no state to consume and nothing to recycle. That
        is what the 80 bytes buy.</p>
        <p><strong>Why <code>ValueTask</code> cannot.</strong> It may be backed by a pooled
        <code>IValueTaskSource</code> that is returned to its pool the moment the result is read, and
        reused for a different operation. A second await, a stored copy, or a concurrent consumer is
        then reading someone else's operation.</p>
        <p><strong>The trap this exercise is really about</strong> is that the unsafe version
        <em>works in testing</em>. The demonstration above awaited a <code>ValueTask</code> twice and
        got the right answer, because that one wrapped a plain Task. Whether it breaks depends on the
        implementation behind the interface — which can change in a library upgrade without any
        change to your code.</p>
        <p><strong>The escape hatch is <code>AsTask()</code></strong>, called once and immediately.
        It converts to a real Task with all the safety back, at exactly the allocation
        <code>ValueTask</code> existed to avoid. That is the right trade when you need to store or
        share, and it is a signal that <code>Task</code> was the correct return type in the first
        place.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Wrap a callback-based API — <code>Run(input, onSuccess, onError)</code> — so it can be awaited,
    supports cancellation, and does not run continuations on the library's thread.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="The wrapper"><code>public Task&lt;string&gt; RunAsync(string input, CancellationToken ct = default)
{
    var tcs = new TaskCompletionSource&lt;string&gt;(
        TaskCreationOptions.RunContinuationsAsynchronously);

    var reg = ct.Register(() =&gt; tcs.TrySetCanceled(ct));

    Run(input,
        r =&gt; { reg.Dispose(); tcs.TrySetResult(r); },
        e =&gt; { reg.Dispose(); tcs.TrySetException(e); });

    return tcs.Task;
}</code></pre>
        <pre data-lang="console" data-title="Actual output"><code>success   : RESULT-ok
failure   : it failed
cancelled : OperationCanceledException

and the flag that matters:
without RunContinuationsAsynchronously, the continuation runs on
the CALLBACK's thread: same thread (10) — INLINE
with it, on a pool thread                      : different thread (11 -&gt; 5)</code></pre>
        <p><strong>Every line in that method is load-bearing.</strong></p>
        <p><strong><code>RunContinuationsAsynchronously</code>.</strong> Measured: without it, the
        continuation ran on thread 10 — the same thread that called <code>SetResult</code>, which
        belongs to the library. Everything awaiting your task then executes inside their callback.
        A slow continuation stalls their internals; one that blocks on a lock that thread holds
        deadlocks code you cannot see.</p>
        <p><strong><code>TrySetResult</code> rather than <code>SetResult</code>.</strong> A callback
        API that fires twice — or a race between the success callback and the cancellation
        registration — calls a setter twice. <code>SetResult</code> throws
        <code>InvalidOperationException</code> the second time, on a thread with no handler, which
        terminates the process. The <code>Try</code> variants return <code>false</code>.</p>
        <p><strong><code>ct.Register</code>, and disposing the registration.</strong> Without the
        registration, a cancelled token does nothing and the caller waits for a callback that may
        never come. Without <code>reg.Dispose()</code>, the registration keeps the token source
        holding a reference to the closure — a slow leak on a long-lived
        <code>CancellationTokenSource</code>, which is exactly what a request-scoped token linked to
        an application-lifetime one is.</p>
        <p><strong>What this does not do, deliberately:</strong> it does not cancel the underlying
        operation. The callback API has no cancellation, so the token makes your <em>await</em> stop
        waiting while the work continues in the background. That is honest and often correct, but it
        must be understood — a cancelled request that still charges a card is worse than one that
        never cancels.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is a Task?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>An <strong>object holding an outcome</strong> — value, cancellation or exception. Not a
        thread and not the operation. Verified: a <code>TaskCompletionSource</code> task exists with
        no operation behind it at all.</p>
      </div></details>
    </li>
    <li>
      <p>When does the work in a Task start?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the task is <strong>created</strong>, not when awaited. Measured: a 200 ms operation
        finished during an unrelated 150 ms sleep — total 229 ms, not 350.</p>
      </div></details>
    </li>
    <li>
      <p>What happens if you await the same Task twice?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>You read the same outcome again — verified, the body ran <strong>once</strong>. Tasks are
        safe to await repeatedly, to store, and to share between threads.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>ValueTask</code> save, and when?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>80 bytes per call</strong>, only when the method completes without suspending.
        Measured: 0 bytes on the hit path against Task's 80.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>ValueTask</code> cost on a path that always awaits?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It is <strong>worse</strong> — 128 bytes against Task's 112 — because it allocates the
        state machine anyway and boxes itself on top. Plus four consumption rules.</p>
      </div></details>
    </li>
    <li>
      <p>Name the four <code>ValueTask</code> rules.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Await it <strong>once</strong>; do not <strong>block</strong> on it; do not await it
        <strong>concurrently</strong>; store the <strong>result</strong>, never the
        <code>ValueTask</code>. <code>AsTask()</code> lifts all four, at the cost you were
        avoiding.</p>
      </div></details>
    </li>
    <li>
      <p>Why is violating those rules dangerous rather than merely wrong?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Because it <strong>works when the fast path is taken</strong> — measured, awaiting twice
        returned the right answer — and the fast path is what a test with a warm cache always takes.
        The bug ships invisibly.</p>
      </div></details>
    </li>
    <li>
      <p>What is <code>TaskCompletionSource</code> for?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Creating a Task you complete yourself — the tool for turning a callback or event API into
        an awaitable one, where the error callback becomes an exception thrown at the
        <code>await</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why does <code>RunContinuationsAsynchronously</code> matter?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Without it, continuations run <strong>inline on whichever thread called
        <code>SetResult</code></strong> — measured as the same thread id. That thread belongs to the
        library, and blocking it can deadlock code you do not own.</p>
      </div></details>
    </li>
    <li>
      <p>How does a faulted Task carry its exception?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>As an <code>AggregateException</code> in <code>Exception</code>. <code>await</code>
        unwraps and throws the original; <code>.Result</code> throws the wrapper — so a
        <code>catch</code> written for one misses the other.</p>
      </div></details>
    </li>
    <li>
      <p>Does <code>Task.FromResult</code> avoid allocating?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — measured at <strong>80 bytes</strong>. It skips the state machine but still creates a
        Task. Only <code>Task.CompletedTask</code> is a cached singleton.</p>
      </div></details>
    </li>
    <li>
      <p>What decides whether to use <code>ValueTask</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The <strong>synchronous-completion rate</strong>, measured. Saving was 100% at a 100% hit
        rate, 64% at 90%, 17% at 50%, and nothing at 0%. If you cannot state the rate, use
        <code>Task</code>.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
