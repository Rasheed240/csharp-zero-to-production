CSPREP.module({
  id: "t2-03-what-async-really-is",
  minutes: 55,
  updated: "2026-08-30",
  summary: "An operation awaiting I/O occupies no thread — measured as 1,012 OS threads against 12 for the same thousand concurrent waits. Everything else follows: async buys capacity rather than speed, it makes a single request no faster and never will, it does nothing at all for CPU-bound work, and the word async by itself starts nothing concurrent.",
  terms: ["async", "await", "asynchronous", "synchronous", "I/O-bound", "CPU-bound",
    "continuation", "completion port", "capacity", "throughput", "latency",
    "concurrency", "parallelism", "thread affinity", "Task.Run", "WhenAll"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>The two previous modules measured a trap with no exit. Threads are how you get several things
  happening at once. A thread costs 552 microseconds to create and 24 KB to keep. The thread pool
  keeps them alive but adds new ones at about two per second, so a service whose handlers wait on
  a network call runs out and queues — measured as
  <strong>2,917 milliseconds for work that should take 100</strong>.</p>

  <p>Every option in that framing is bad. More threads: oversubscription. Fewer threads: less
  concurrency. A bigger pool minimum: a guess that is wrong at the next traffic level.</p>

  <p>The trap exists because of an assumption nobody stated: that an operation in progress needs a
  thread. For computation that is true. <strong>For waiting it is not, and it never was</strong> —
  the operating system has been able to tell you "this network read has finished" without a thread
  sitting on it since long before C# existed.</p>

  <p><code>async</code> and <code>await</code> are how C# lets you use that. This module establishes
  exactly what they do, which is narrower and more valuable than the reputation suggests, and
  measures the three things people believe about them that are wrong.</p>
</section>

<section id="no-thread">
  <h2>The one claim that matters</h2>

  <p class="define"><span class="define__term">Asynchronous</span> An operation you start now and
  learn about later, without waiting for it in between.
  <span class="define__term">Synchronous</span> the opposite: the calling code does not proceed until
  the operation is finished.</p>

  <p class="define"><span class="define__term">I/O-bound</span> Work whose duration is set by
  something outside the process — a network round trip, a disk read, a database query. The CPU is
  idle for nearly all of it. <span class="define__term">CPU-bound</span> work whose duration is set
  by how fast the processor can execute it. <strong>Async addresses only the first.</strong></p>

  <p class="define"><span class="define__term">await</span> A keyword meaning "suspend this method
  here until that operation completes, and <strong>release the thread while waiting</strong>". The
  suspension is the ordinary part. The release is the whole point.</p>

  <p>The analogy: a synchronous wait is <strong>standing at the counter until your coffee is
  ready</strong>; an asynchronous one is <strong>giving your name and sitting down</strong>. The
  coffee takes the same time either way. What changes is whether the queue behind you can move.
  <strong>The analogy breaks in one place worth naming</strong> — when your name is called you may
  be a different person, in the sense that the method resumes on whatever thread is free rather
  than the one it started on.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-no-thread.cs"><code>// 01-no-thread.cs — the one claim this module exists to establish: an operation
// awaiting I/O occupies NO thread. Everything else about async follows from it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-no-thread.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Operations = 1_000;
    const int WaitMs = 200;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine($"{Operations:N0} concurrent operations, each waiting {WaitMs} ms.");
        Console.WriteLine();

        Console.WriteLine("--- 1,000 operations, one thread each ---");
        var blocking = MeasureThreads(() =&gt;
        {
            var threads = new Thread[Operations];
            for (var i = 0; i &lt; Operations; i++)
            {
                threads[i] = new Thread(() =&gt; Thread.Sleep(WaitMs)) { IsBackground = true };
                threads[i].Start();
            }
            foreach (var t in threads) t.Join();
        });
        Console.WriteLine($"  elapsed          : {blocking.ms,7:N0} ms");
        Console.WriteLine($"  OS threads peak  : {blocking.peakOs}");
        Console.WriteLine($"  memory delta     : {blocking.memoryKb:N0} KB");

        Console.WriteLine();
        Console.WriteLine("--- the same 1,000 operations, awaited ---");
        var asyncRun = MeasureThreads(() =&gt;
        {
            Task.WhenAll(Enumerable.Range(0, Operations).Select(_ =&gt; Task.Delay(WaitMs)))
                .GetAwaiter().GetResult();
        });
        Console.WriteLine($"  elapsed          : {asyncRun.ms,7:N0} ms");
        Console.WriteLine($"  OS threads peak  : {asyncRun.peakOs}");
        Console.WriteLine($"  memory delta     : {asyncRun.memoryKb:N0} KB");

        Console.WriteLine();
        Console.WriteLine("--- side by side ---");
        Console.WriteLine($"  elapsed   : {blocking.ms:N0} ms  vs  {asyncRun.ms:N0} ms");
        Console.WriteLine($"  threads   : {blocking.peakOs}  vs  {asyncRun.peakOs}   " +
                          $"({blocking.peakOs - asyncRun.peakOs} fewer)");
        Console.WriteLine($"  memory    : {blocking.memoryKb:N0} KB  vs  {asyncRun.memoryKb:N0} KB");
        Console.WriteLine();
        Console.WriteLine("  Same work, same wall-clock outcome, and one of them did not need");
        Console.WriteLine("  a thousand threads. THAT is what async buys. It is not speed.");

        Console.WriteLine();
        Console.WriteLine("--- where is the thread during an await? ---");
        Console.WriteLine("  Nowhere. There is no thread. The operation is a registration:");
        Console.WriteLine("  the OS is told 'when this completes, run this continuation', and");
        Console.WriteLine("  the calling thread returns to the pool to do other work.");
        Console.WriteLine();
        DemonstrateThreadHopping().GetAwaiter().GetResult();

        Console.WriteLine();
        Console.WriteLine("--- proof that the pool is free during the wait ---");
        Console.WriteLine("  While 1,000 operations are awaiting, queue CPU work and see how");
        Console.WriteLine("  quickly it runs. If the awaits held threads, it would wait.");
        Console.WriteLine();
        var pending = Task.WhenAll(Enumerable.Range(0, Operations).Select(_ =&gt; Task.Delay(WaitMs)));
        Thread.Sleep(30);
        var sw = Stopwatch.StartNew();
        var cpuDone = Task.Run(() =&gt; Burn(20_000_000));
        cpuDone.Wait();
        sw.Stop();
        Console.WriteLine($"  CPU work started and finished in {sw.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine($"  while {Operations:N0} operations were mid-await");
        Console.WriteLine($"  pool threads at that moment : {ThreadPool.ThreadCount}");
        pending.GetAwaiter().GetResult();
        Console.WriteLine("  It did not queue behind them, because they were not there.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static async Task DemonstrateThreadHopping()
    {
        Console.WriteLine($"  before any await : thread {Environment.CurrentManagedThreadId}, " +
                          $"pool={Thread.CurrentThread.IsThreadPoolThread}");
        await Task.Delay(50).ConfigureAwait(false);
        Console.WriteLine($"  after 1st await  : thread {Environment.CurrentManagedThreadId}, " +
                          $"pool={Thread.CurrentThread.IsThreadPoolThread}");
        await Task.Delay(50).ConfigureAwait(false);
        Console.WriteLine($"  after 2nd await  : thread {Environment.CurrentManagedThreadId}, " +
                          $"pool={Thread.CurrentThread.IsThreadPoolThread}");
        Console.WriteLine("  The thread can change at every await. A method is not tied to");
        Console.WriteLine("  one thread, which is why thread-affine state does not survive");
        Console.WriteLine("  an await and why locks cannot be held across one.");
    }

    static long _sink;

    static void Burn(long n)
    {
        long acc = 0;
        for (long i = 0; i &lt; n; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }

    static (double ms, int peakOs, long memoryKb) MeasureThreads(Action run)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        Thread.Sleep(300);

        var proc = Process.GetCurrentProcess();
        proc.Refresh();
        var startOs = proc.Threads.Count;
        var startMem = proc.WorkingSet64;
        var peak = startOs;

        using var sampler = new Timer(_ =&gt;
        {
            var p = Process.GetCurrentProcess();
            p.Refresh();
            if (p.Threads.Count &gt; peak) peak = p.Threads.Count;
        }, null, 0, 5);

        var sw = Stopwatch.StartNew();
        run();
        sw.Stop();

        proc.Refresh();
        return (sw.Elapsed.TotalMilliseconds, peak, (proc.WorkingSet64 - startMem) / 1024);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>processors: 8
1,000 concurrent operations, each waiting 200 ms.

--- 1,000 operations, one thread each ---
  elapsed          :     371 ms
  OS threads peak  : 1012
  memory delta     : 7,508 KB

--- the same 1,000 operations, awaited ---
  elapsed          :     212 ms
  OS threads peak  : 12
  memory delta     : 520 KB

--- side by side ---
  elapsed   : 371 ms  vs  212 ms
  threads   : 1012  vs  12   (1000 fewer)
  memory    : 7,508 KB  vs  520 KB

  Same work, same wall-clock outcome, and one of them did not need
  a thousand threads. THAT is what async buys. It is not speed.

--- where is the thread during an await? ---
  Nowhere. There is no thread. The operation is a registration:
  the OS is told 'when this completes, run this continuation', and
  the calling thread returns to the pool to do other work.

  before any await : thread 2, pool=False
  after 1st await  : thread 1001, pool=True
  after 2nd await  : thread 1001, pool=True
  The thread can change at every await. A method is not tied to
  one thread, which is why thread-affine state does not survive
  an await and why locks cannot be held across one.

--- proof that the pool is free during the wait ---
  While 1,000 operations are awaiting, queue CPU work and see how
  quickly it runs. If the awaits held threads, it would wait.

  CPU work started and finished in 27 ms
  while 1,000 operations were mid-await
  pool threads at that moment : 8
  It did not queue behind them, because they were not there.
  (checksum 59999997)</code></pre>

  <p><strong>1,012 OS threads against 12, for the same thousand concurrent waits.</strong> Exactly a
  thousand fewer, and 7,508 KB of working set against 520.</p>

  <p><strong>The last measurement is the proof.</strong> With a thousand operations mid-await, CPU
  work queued to the pool started and finished in <strong>27 milliseconds</strong>, on a pool holding
  <strong>8 threads</strong>. If those awaits were holding threads, that work would have queued
  behind them. It did not queue, because they were not there.</p>

  <p class="define"><span class="define__term">Latency</span> How long one operation takes.
  <span class="define__term">Throughput</span> how many complete per unit of time.
  <span class="define__term">Capacity</span> how many can be in flight at once. Async changes the
  third, which changes the second under load, and never changes the first — the distinction the
  whole module turns on.</p>

  <p class="define"><span class="define__term">Continuation</span> The rest of the method after an
  <code>await</code>. The runtime registers it with the operating system's I/O notification mechanism
  and returns the thread. When the I/O finishes, the continuation is queued to the pool like any
  other work item.</p>

  <p class="define"><span class="define__term">Completion port</span> The operating-system facility
  that reports finished I/O — an I/O completion port on Windows, <code>epoll</code> or
  <code>kqueue</code> on Linux and macOS. A small number of threads can service notifications for a
  very large number of outstanding operations, which is the mechanism the whole model rests on.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>A method is not tied to one thread.</strong> Measured: entering on thread 2, resuming
    on thread 1001. That has three consequences that catch people —
    <code>[ThreadStatic]</code> and thread-affine state do not survive an <code>await</code>, a
    <code>lock</code> cannot be held across one (the compiler refuses:
    <code>CS1996</code>), and <code>Thread.CurrentThread</code> is not a stable identity for the
    duration of a logical operation.</p>
  </div>
</section>

<section id="not-parallel">
  <h2>Three things async is not</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-not-parallel.cs"><code>// 02-not-parallel.cs — async is not parallelism, and applying it to CPU-bound
// work buys nothing. Both halves measured, because "async makes it faster" is
// the most expensive misunderstanding in this track.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-not-parallel.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine();

        Console.WriteLine("=== 1. an async method with no await runs entirely synchronously ===");
        var sw = Stopwatch.StartNew();
        var t = NoAwaitAsync();
        var elapsedBeforeAwait = sw.Elapsed.TotalMilliseconds;
        t.GetAwaiter().GetResult();
        sw.Stop();
        Console.WriteLine($"  time for the CALL to return   : {elapsedBeforeAwait:N0} ms");
        Console.WriteLine($"  total                         : {sw.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine($"  task already completed on return : {t.IsCompleted}");
        Console.WriteLine("  The word 'async' started nothing. The body ran on the calling");
        Console.WriteLine("  thread, to completion, before the method returned.");

        Console.WriteLine();
        Console.WriteLine("=== 2. awaiting sequentially is not concurrent ===");
        var sequential = Time(() =&gt; ThreeSequential().GetAwaiter().GetResult());
        var concurrent = Time(() =&gt; ThreeConcurrent().GetAwaiter().GetResult());
        Console.WriteLine($"  three 200 ms operations, awaited one after another : {sequential,6:N0} ms");
        Console.WriteLine($"  three 200 ms operations, started then awaited      : {concurrent,6:N0} ms");
        Console.WriteLine("  'await' does not mean 'in parallel'. It means 'stop here until");
        Console.WriteLine("  this finishes, without holding a thread'. Concurrency comes from");
        Console.WriteLine("  STARTING several before awaiting any.");

        Console.WriteLine();
        Console.WriteLine("=== 3. async over CPU-bound work buys nothing ===");
        const long Work = 200_000_000;
        var direct = Time(() =&gt; Burn(Work));
        var wrapped = Time(() =&gt; Task.Run(() =&gt; Burn(Work)).GetAwaiter().GetResult());
        var awaited = Time(() =&gt; CpuAsync(Work).GetAwaiter().GetResult());
        Console.WriteLine($"  called directly            : {direct,6:N0} ms");
        Console.WriteLine($"  wrapped in Task.Run        : {wrapped,6:N0} ms  ({wrapped / direct:N2}x)");
        Console.WriteLine($"  in an async method         : {awaited,6:N0} ms  ({awaited / direct:N2}x)");
        Console.WriteLine("  Not identical — SLOWER. There is no I/O to overlap with, so async");
        Console.WriteLine("  has nothing to hide, and what is left is its overhead: a task");
        Console.WriteLine("  object, a state machine, and for Task.Run a hop to another thread");
        Console.WriteLine("  and back. Task.Run moved the work; it did not make it smaller.");
        Console.WriteLine("  The exact multiplier is noisy run to run, but the direction is not:");
        Console.WriteLine("  wrapping CPU work in async never makes it faster.");

        Console.WriteLine();
        Console.WriteLine("=== 4. what DOES make CPU-bound work faster is parallelism ===");
        var parallel = Time(() =&gt;
        {
            Parallel.For(0, Environment.ProcessorCount, _ =&gt; Burn(Work / Environment.ProcessorCount));
        });
        Console.WriteLine($"  split across {Environment.ProcessorCount} cores : {parallel,6:N0} ms  " +
                          $"({direct / parallel:N2}x faster than one core)");
        Console.WriteLine("  Different tool, different problem. Parallelism divides CPU work");
        Console.WriteLine("  across cores. Async avoids holding a thread while WAITING.");
        Console.WriteLine("  Confusing them is why 'we made it async and it got slower' is a");
        Console.WriteLine("  sentence people say.");

        Console.WriteLine();
        Console.WriteLine("=== 5. and async over CPU work on a server is actively harmful ===");
        Console.WriteLine("  Task.Run on a request path takes a pool thread to do CPU work,");
        Console.WriteLine("  while the request's own thread waits for it. Two threads are now");
        Console.WriteLine("  involved where one was needed, and the pool is the resource under");
        Console.WriteLine("  pressure. Measured:");
        var poolCost = Time(() =&gt;
        {
            Task.WhenAll(Enumerable.Range(0, 64)
                .Select(_ =&gt; Task.Run(() =&gt; Burn(Work / 64)))).GetAwaiter().GetResult();
        });
        var straight = Time(() =&gt;
        {
            for (var i = 0; i &lt; 64; i++) Burn(Work / 64);
        });
        Console.WriteLine($"    64 chunks via Task.Run : {poolCost,6:N0} ms");
        Console.WriteLine($"    the same, in a loop    : {straight,6:N0} ms");
        Console.WriteLine("  Task.Run wins here because this process has spare cores. On a");
        Console.WriteLine("  server already using them all for other requests, it does not.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static async Task NoAwaitAsync()
    {
        Burn(100_000_000);
        await Task.CompletedTask;      // completes synchronously: no suspension
    }

    static async Task ThreeSequential()
    {
        await Task.Delay(200).ConfigureAwait(false);
        await Task.Delay(200).ConfigureAwait(false);
        await Task.Delay(200).ConfigureAwait(false);
    }

    static async Task ThreeConcurrent()
    {
        var a = Task.Delay(200);
        var b = Task.Delay(200);
        var c = Task.Delay(200);
        await Task.WhenAll(a, b, c).ConfigureAwait(false);
    }

    static async Task CpuAsync(long work)
    {
        Burn(work);
        await Task.CompletedTask;
    }

    static void Burn(long n)
    {
        long acc = 0;
        for (long i = 0; i &lt; n; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
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

  <pre data-lang="console" data-title="Output"><code>processors: 8

=== 1. an async method with no await runs entirely synchronously ===
  time for the CALL to return   : 164 ms
  total                         : 164 ms
  task already completed on return : True
  The word 'async' started nothing. The body ran on the calling
  thread, to completion, before the method returned.

=== 2. awaiting sequentially is not concurrent ===
  three 200 ms operations, awaited one after another :    613 ms
  three 200 ms operations, started then awaited      :    202 ms
  'await' does not mean 'in parallel'. It means 'stop here until
  this finishes, without holding a thread'. Concurrency comes from
  STARTING several before awaiting any.

=== 3. async over CPU-bound work buys nothing ===
  called directly            :    309 ms
  wrapped in Task.Run        :    350 ms  (1.13x)
  in an async method         :    406 ms  (1.32x)
  Not identical — SLOWER. There is no I/O to overlap with, so async
  has nothing to hide, and what is left is its overhead: a task
  object, a state machine, and for Task.Run a hop to another thread
  and back. Task.Run moved the work; it did not make it smaller.
  The exact multiplier is noisy run to run, but the direction is not:
  wrapping CPU work in async never makes it faster.

=== 4. what DOES make CPU-bound work faster is parallelism ===
  split across 8 cores :    102 ms  (2.89x faster than one core)
  Different tool, different problem. Parallelism divides CPU work
  across cores. Async avoids holding a thread while WAITING.
  Confusing them is why 'we made it async and it got slower' is a
  sentence people say.

=== 5. and async over CPU work on a server is actively harmful ===
  Task.Run on a request path takes a pool thread to do CPU work,
  while the request's own thread waits for it. Two threads are now
  involved where one was needed, and the pool is the resource under
  pressure. Measured:
    64 chunks via Task.Run :    101 ms
    the same, in a loop    :    363 ms
  Task.Run wins here because this process has spare cores. On a
  server already using them all for other requests, it does not.
  (checksum 7499998327)</code></pre>

  <h3>It is not "start this in the background"</h3>

  <p>An <code>async</code> method with no suspension point runs <strong>entirely on the calling
  thread, to completion, before it returns</strong>. Measured: the call itself took 164 ms and the
  returned task was already complete.</p>

  <p><code>async</code> is not a modifier that makes a method run elsewhere. It is permission for the
  method to <em>suspend</em>, and a method that never suspends never does.</p>

  <p class="define"><span class="define__term">Thread affinity</span> Code that depends on running
  on one particular thread throughout. An async method has none: it may resume on any pool thread,
  measured here as entering on thread 2 and resuming on 1001.</p>

  <h3>It is not parallelism</h3>

  <p>Three 200-millisecond operations awaited one after another took <strong>613 ms</strong>.
  The same three started first and then awaited took <strong>202</strong>.</p>

  <p><strong>Concurrency comes from starting things, not from awaiting them.</strong>
  <code>await</code> means "stop here until this finishes, without holding a thread" — and
  <em>stop here</em> is the operative half. Both versions are fully asynchronous; only one is
  concurrent.</p>

  <h3>It does nothing for CPU-bound work</h3>

  <p>Measured: 309 ms directly, 350 ms wrapped in <code>Task.Run</code>, 406 ms inside an async
  method. <strong>Slower, not equal.</strong> With no I/O to overlap, all that is left is the
  overhead — a task object, a state machine, and for <code>Task.Run</code> a hop to another thread
  and back.</p>

  <p>What <em>does</em> speed up CPU work is parallelism: <strong>2.89× across 8 logical
  processors</strong>. Different tool, different problem, and confusing them is why "we made it async
  and it got slower" is a sentence people say.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong><code>Task.Run</code> on a server request path is usually a mistake.</strong> It takes
    a pool thread to do CPU work while the request's own thread waits for it — two threads where one
    was needed, and the pool is exactly the resource under pressure. It measured <em>faster</em>
    above only because this process had spare cores. A server already using its cores for other
    requests has none to give, and the operation becomes a queue on the resource you were trying to
    protect.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// 05-minimal-example.cs — the module's minimal example, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading.Tasks;

class Program
{
    // A method that waits, without holding a thread while it waits.
    static async Task&lt;string&gt; FetchAsync(string name, int milliseconds)
    {
        await Task.Delay(milliseconds);          // suspends here; the thread is released
        return $"{name} after {milliseconds} ms";
    }

    static async Task Main()
    {
        // SEQUENTIAL: each await finishes before the next call starts.
        var sw = Stopwatch.StartNew();
        Console.WriteLine(await FetchAsync("first", 200));
        Console.WriteLine(await FetchAsync("second", 200));
        Console.WriteLine($"sequential: {sw.ElapsedMilliseconds} ms");

        // CONCURRENT: both are started, then both are awaited.
        sw.Restart();
        var a = FetchAsync("first", 200);
        var b = FetchAsync("second", 200);
        foreach (var line in await Task.WhenAll(a, b)) Console.WriteLine(line);
        Console.WriteLine($"concurrent: {sw.ElapsedMilliseconds} ms");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>first after 200 ms
second after 200 ms
sequential: 440 ms
first after 200 ms
second after 200 ms
concurrent: 202 ms</code></pre>

  <p>Two identical calls, two different results, and the difference is one line of structure. In the
  first version <code>FetchAsync("second", …)</code> is not <em>called</em> until the first
  <code>await</code> has completed. In the second, both calls happen before either
  <code>await</code>.</p>

  <p><strong>That is the single most common async mistake in real code</strong>, and it is invisible
  in review because both versions look correct and both are genuinely asynchronous.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-production.cs"><code>// 03-production.cs — a Ledger endpoint under load, three ways, showing what
// async actually buys: not latency for one request, but capacity for many.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Api;

public sealed record Invoice(string Number, decimal AmountMinor);

/// &lt;summary&gt;Three downstream calls a settlement endpoint makes per request.&lt;/summary&gt;
public sealed class Downstreams
{
    public const int DbMs = 25;
    public const int GatewayMs = 60;
    public const int AuditMs = 15;

    public void ReadInvoiceSync(string _) =&gt; Thread.Sleep(DbMs);
    public void AuthoriseSync(string _) =&gt; Thread.Sleep(GatewayMs);
    public void WriteAuditSync(string _) =&gt; Thread.Sleep(AuditMs);

    public Task ReadInvoiceAsync(string _, CancellationToken ct = default) =&gt; Task.Delay(DbMs, ct);
    public Task AuthoriseAsync(string _, CancellationToken ct = default) =&gt; Task.Delay(GatewayMs, ct);
    public Task WriteAuditAsync(string _, CancellationToken ct = default) =&gt; Task.Delay(AuditMs, ct);
}

class Program
{
    static readonly Downstreams Down = new();
    const int Ideal = Downstreams.DbMs + Downstreams.GatewayMs + Downstreams.AuditMs;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine($"one request = {Downstreams.DbMs} + {Downstreams.GatewayMs} + " +
                          $"{Downstreams.AuditMs} = {Ideal} ms of waiting, ~0 ms of CPU");
        Console.WriteLine();
        Console.WriteLine("A single request cannot go faster than 100 ms either way. What");
        Console.WriteLine("changes with load is how many can be in flight at once.");
        Console.WriteLine();
        Console.WriteLine("  concurrent   sync: total  p99  OS threads      async: total  p99  OS threads");

        foreach (var concurrency in new[] { 1, 8, 50, 200 })
        {
            var s = Measure(concurrency, sync: true);
            var a = Measure(concurrency, sync: false);
            Console.WriteLine($"  {concurrency,10}   {s.total,10:N0} {s.p99,6:N0} {s.threads,10}      " +
                              $"{a.total,10:N0} {a.p99,6:N0} {a.threads,10}");
        }

        Console.WriteLine();
        Console.WriteLine("--- reading it ---");
        Console.WriteLine();
        Console.WriteLine("  At concurrency 1 they are the same. Async did not make the");
        Console.WriteLine("  request faster and never will: the 100 ms is the downstream's,");
        Console.WriteLine("  not yours.");
        Console.WriteLine();
        Console.WriteLine("  At 200 the sync version takes 25x longer in TOTAL — and note");
        Console.WriteLine("  what the thread count did NOT do. It did not climb to 200. The");
        Console.WriteLine("  pool refused, at the injection rate measured in t2-02, so the");
        Console.WriteLine("  requests QUEUED instead. Sync does not consume 200 threads here;");
        Console.WriteLine("  it consumes 18 and makes everyone else wait.");
        Console.WriteLine();
        Console.WriteLine("  NOW LOOK AT THE p99 COLUMN. It says 125 ms for the sync run that");
        Console.WriteLine("  took 2.6 seconds. That is not a bug in the measurement — it is the");
        Console.WriteLine("  measurement most services actually take. The stopwatch starts when");
        Console.WriteLine("  the work item begins RUNNING, after it has been dequeued, so the");
        Console.WriteLine("  queueing time is invisible to it.");
        Console.WriteLine();
        Console.WriteLine("  A latency metric that starts inside the handler will report a");
        Console.WriteLine("  perfectly healthy service while requests wait seconds to reach");
        Console.WriteLine("  that handler. If your p99 looks fine and your users disagree,");
        Console.WriteLine("  check where the clock starts.");
        Console.WriteLine();
        Console.WriteLine("  THAT is the trade. Async buys capacity, not speed. A team that");
        Console.WriteLine("  measures it with one request concludes it does nothing, and a");
        Console.WriteLine("  team that measures under load concludes it is essential. Both");
        Console.WriteLine("  measured correctly.");

        Console.WriteLine();
        Console.WriteLine("--- and the sequential-await trap, in the same endpoint ---");
        var seq = TimeOne(() =&gt; HandleAsync("INV-1").GetAwaiter().GetResult());
        var par = TimeOne(() =&gt; HandleAsyncOverlapped("INV-1").GetAwaiter().GetResult());
        Console.WriteLine($"  three awaits in sequence          : {seq,6:N0} ms");
        Console.WriteLine($"  audit started before authorise    : {par,6:N0} ms");
        Console.WriteLine("  Being async does not overlap anything by itself. These two");
        Console.WriteLine("  methods are both fully async; only one of them is concurrent.");
        Console.WriteLine("  (The read must finish first — it produces the invoice. The audit");
        Console.WriteLine("  write does not depend on the authorisation, so it can overlap.)");
    }

    static void HandleSync(string number)
    {
        Down.ReadInvoiceSync(number);
        Down.AuthoriseSync(number);
        Down.WriteAuditSync(number);
    }

    static async Task HandleAsync(string number)
    {
        await Down.ReadInvoiceAsync(number).ConfigureAwait(false);
        await Down.AuthoriseAsync(number).ConfigureAwait(false);
        await Down.WriteAuditAsync(number).ConfigureAwait(false);
    }

    static async Task HandleAsyncOverlapped(string number)
    {
        await Down.ReadInvoiceAsync(number).ConfigureAwait(false);
        var authorise = Down.AuthoriseAsync(number);
        var audit = Down.WriteAuditAsync(number);
        await Task.WhenAll(authorise, audit).ConfigureAwait(false);
    }

    static (double total, double p99, int threads) Measure(int concurrency, bool sync)
    {
        Thread.Sleep(600);
        var proc = Process.GetCurrentProcess();
        proc.Refresh();
        var startThreads = proc.Threads.Count;
        var peak = startThreads;
        using var sampler = new Timer(_ =&gt;
        {
            var p = Process.GetCurrentProcess();
            p.Refresh();
            if (p.Threads.Count &gt; peak) peak = p.Threads.Count;
        }, null, 0, 5);

        var latencies = new double[concurrency];
        var sw = Stopwatch.StartNew();

        if (sync)
        {
            var done = new CountdownEvent(concurrency);
            for (var i = 0; i &lt; concurrency; i++)
            {
                var n = i;
                ThreadPool.QueueUserWorkItem(_ =&gt;
                {
                    var w = Stopwatch.StartNew();
                    HandleSync($"INV-{n}");
                    latencies[n] = w.Elapsed.TotalMilliseconds;
                    done.Signal();
                });
            }
            done.Wait();
        }
        else
        {
            Task.WhenAll(Enumerable.Range(0, concurrency).Select(async n =&gt;
            {
                var w = Stopwatch.StartNew();
                await HandleAsync($"INV-{n}").ConfigureAwait(false);
                latencies[n] = w.Elapsed.TotalMilliseconds;
            })).GetAwaiter().GetResult();
        }

        sw.Stop();
        Array.Sort(latencies);
        var p99 = latencies[(int)Math.Min(latencies.Length - 1, latencies.Length * 0.99)];
        // Absolute peak, not a delta. The pool keeps threads between runs, so a
        // delta credits a later run with threads an earlier one created. The
        // baseline here is ~15 runtime threads.
        return (sw.Elapsed.TotalMilliseconds, p99, peak);
    }

    static double TimeOne(Action a)
    {
        a();
        var sw = Stopwatch.StartNew();
        a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>processors: 8
one request = 25 + 60 + 15 = 100 ms of waiting, ~0 ms of CPU

A single request cannot go faster than 100 ms either way. What
changes with load is how many can be in flight at once.

  concurrent   sync: total  p99  OS threads      async: total  p99  OS threads
           1          123    118         12             123    120         12
           8          106    106         17             106    106         17
          50          659    123         18             105    105         18
         200        2,649    125         18             104    104         18

--- reading it ---

  At concurrency 1 they are the same. Async did not make the
  request faster and never will: the 100 ms is the downstream's,
  not yours.

  At 200 the sync version takes 25x longer in TOTAL — and note
  what the thread count did NOT do. It did not climb to 200. The
  pool refused, at the injection rate measured in t2-02, so the
  requests QUEUED instead. Sync does not consume 200 threads here;
  it consumes 18 and makes everyone else wait.

  NOW LOOK AT THE p99 COLUMN. It says 125 ms for the sync run that
  took 2.6 seconds. That is not a bug in the measurement — it is the
  measurement most services actually take. The stopwatch starts when
  the work item begins RUNNING, after it has been dequeued, so the
  queueing time is invisible to it.

  A latency metric that starts inside the handler will report a
  perfectly healthy service while requests wait seconds to reach
  that handler. If your p99 looks fine and your users disagree,
  check where the clock starts.

  THAT is the trade. Async buys capacity, not speed. A team that
  measures it with one request concludes it does nothing, and a
  team that measures under load concludes it is essential. Both
  measured correctly.

--- and the sequential-await trap, in the same endpoint ---
  three awaits in sequence          :    110 ms
  audit started before authorise    :     95 ms
  Being async does not overlap anything by itself. These two
  methods are both fully async; only one of them is concurrent.
  (The read must finish first — it produces the invoice. The audit
  write does not depend on the authorisation, so it can overlap.)</code></pre>

  <p><strong>At concurrency 1 they are identical — 123 ms each.</strong> Async did not make the
  request faster and never will. The 100 milliseconds belongs to the downstream service.</p>

  <p><strong>At concurrency 200 the sync version takes 25× longer in total.</strong> And notice what
  the thread count did <em>not</em> do: it did not climb to 200. The pool refused, at the injection
  rate the previous module measured, so requests queued instead. Sync does not consume 200 threads
  here — it consumes 18 and makes everyone else wait.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Look at the p99 column: 125 ms, for a run that took 2.6 seconds.</strong> That is not
    a broken measurement — it is the measurement most services actually take. The stopwatch starts
    when the handler begins <em>running</em>, after the request has been dequeued, so the time spent
    queueing is invisible to it.</p>
    <p>A latency metric that starts inside your handler will report a perfectly healthy service while
    users wait seconds to reach it. <strong>If your p99 looks fine and your users disagree, check
    where the clock starts.</strong> ASP.NET Core's own request-duration metric starts at the
    beginning of the pipeline for exactly this reason.</p>
  </div>

  <p>The last measurement is the trap from the minimal example, in a realistic handler: three awaits
  in sequence took <strong>110 ms</strong>, and starting the audit write alongside the authorisation
  took <strong>95</strong>. Both methods are fully async. Only one of them overlaps anything.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Awaiting in a loop when the calls are independent</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: N x latency, in sequence"><code>// WRONG when the calls do not depend on each other. Measured: three 200 ms
// operations took 613 ms this way and 202 ms started first.
var results = new List&lt;Invoice&gt;();
foreach (var id in ids)
    results.Add(await _repository.GetAsync(id, ct));   // one at a time

// Right: start them all, then await.
var tasks = ids.Select(id =&gt; _repository.GetAsync(id, ct));
var results = await Task.WhenAll(tasks);</code></pre>

  <p>The corrected version needs a caveat: with 10,000 ids this starts 10,000 concurrent calls and
  overwhelms the downstream. Bounding it is <a href="#/m/t2-14-async-coordination">t2-14</a>.</p>

  <h3>2. <code>Task.Run</code> around CPU work on a request path</h3>

  <p>Measured: 1.13× slower even with spare cores. On a busy server it takes a second pool thread
  while the first waits, and the pool is the contended resource.</p>

  <h3>3. Making a method <code>async</code> that has nothing to await</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: overhead with no benefit"><code>// WRONG. Nothing here suspends, so this is a synchronous method paying for a
// state machine and a Task. Measured at 1.32x the direct call.
public async Task&lt;decimal&gt; CalculateVatAsync(decimal amount)
{
    return amount * 0.20m;
}

// Right: return a completed task, and keep the async signature only if the
// interface requires it.
public Task&lt;decimal&gt; CalculateVatAsync(decimal amount)
    =&gt; Task.FromResult(amount * 0.20m);

// Better: if nothing is asynchronous, do not pretend.
public decimal CalculateVat(decimal amount) =&gt; amount * 0.20m;</code></pre>

  <h3>4. <code>async void</code> anywhere except an event handler</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the caller cannot await it, and an exception kills the process"><code>// WRONG. The caller gets no task, so it cannot await completion or observe
// failure. An exception here does not propagate to a caller — there is nobody
// to propagate to — and reaches the runtime as an unhandled exception on a
// pool thread, which terminates the process.
public async void ProcessAsync(Instruction instruction)
{
    await _gateway.AuthoriseAsync(instruction.Reference);
}

// Right: return a Task so the caller can await it and see failures.
public async Task ProcessAsync(Instruction instruction, CancellationToken ct = default)
{
    await _gateway.AuthoriseAsync(instruction.Reference, ct);
}</code></pre>

  <p>The single legitimate use is an event handler, whose signature is fixed by the delegate. Even
  there the body should catch its own exceptions, because nothing else can.</p>

  <h3>5. Expecting <code>async</code> to speed up one request</h3>

  <p>Measured: identical at concurrency 1 — 123 ms both ways. Async buys capacity. A benchmark with
  one caller will always conclude it does nothing, and will always be right about that one
  caller.</p>

  <h3>6. Holding thread-affine state across an <code>await</code></h3>

  <p>Measured: entering on thread 2, resuming on thread 1001. <code>[ThreadStatic]</code> fields, a
  <code>lock</code> held across the suspension (<code>CS1996</code>), and anything keyed on
  <code>Thread.CurrentThread</code> all break. Use <code>AsyncLocal&lt;T&gt;</code> for state that
  should flow with the logical operation.</p>

  <h3>7. Measuring latency from inside the handler</h3>

  <p>Measured: p99 of 125 ms on a run that took 2,649 ms. The queueing time is invisible to a clock
  that starts after dequeue, so the dashboard stays green through the entire incident.</p>

  <h3>8. Async halfway</h3>

  <p>One blocking frame between the I/O call and the entry point recreates the whole problem, because
  that frame holds a pool thread while waiting for work that needs one — the starvation measured in
  <a href="#/m/t2-02-thread-pool">the previous module</a> at 29.2×.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>"We made it async and nothing improved."</strong> Check the concurrency of the test.
    At one request async is identical by construction — measured at 123 ms both ways. Re-run at the
    concurrency production actually sees; the difference appeared at 50 and was 25× at 200.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>"We made it async and it got slower."</strong> The work is probably CPU-bound, where
    async adds overhead and removes nothing — measured at 1.13× to 1.32×. Run the operation
    single-threaded and watch one core: pinned at 100% means you want parallelism, not async.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>An async operation takes the sum of its parts.</strong> That is the sequential-await
    trap. Read the method and ask which calls actually depend on each other's results; the ones that
    do not should be started before either is awaited. Measured saving in the exercises:
    <strong>187 ms to 141</strong> for one such change.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Confirming that awaits are really releasing threads.</strong> Under load, watch
    <code>ThreadPool.ThreadCount</code>. Genuinely async code holds it near the processor count no
    matter how many operations are in flight — measured as 12 threads for a thousand concurrent
    waits. A count tracking your request rate means something is still blocking.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Latency that looks healthy while users complain.</strong> Check where the clock
    starts. A timer inside the handler cannot see queueing — measured as p99 125 ms during a 2.6
    second run. Compare a handler-side metric against one taken at the edge, or against the client's
    own measurement; a large gap between them <em>is</em> the queue.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Deciding whether something should be async at all.</strong> One question: does it
    wait for something outside this process? Network, disk, database, another service — async. Pure
    computation — not async, and possibly parallel. Something that does neither and returns a value
    immediately — neither.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's settlement endpoint made three downstream calls per
    request: a database read, a gateway authorisation, and an audit write. The handler was
    synchronous, and at its normal load of roughly 20 concurrent requests it was healthy — around
    100 ms, which is what the three downstream calls cost.</p>
    <p>A migration doubled traffic. Latency went to several seconds, and the team did what the
    dashboards suggested: added instances. It helped less than expected, because each instance still
    queued at the same concurrency. They added more. The bill roughly tripled and p99 stayed
    poor.</p>
    <p>Two things kept the diagnosis away from the actual cause for most of a week.</p>
    <p><strong>The latency metric was taken inside the handler.</strong> It read about 125 ms
    throughout — the figure measured above — because the stopwatch started after the request had
    been dequeued. Every internal dashboard said the service was fast, and the only contrary evidence
    was the customer's own timing.</p>
    <p><strong>And CPU was low</strong>, around 20%, so every instinct pointed at the downstream
    services. The gateway team was asked twice to check their latency, and twice reported it
    unchanged at 60 ms. They were right.</p>
    <p>The change was to make the handler and everything under it async. <strong>No downstream call
    got faster; the endpoint's single-request latency was identical afterwards</strong>, exactly as
    measured at concurrency 1. What changed was the shape under load: at 200 concurrent the same
    endpoint went from 2,649 ms to 104, and the instance count was reduced below its original
    number.</p>
    <p>The follow-up that mattered more than the fix was moving the latency metric to the start of
    the pipeline, so the next time a queue formed the graph would show it.</p>
  </div>

  <p>The general principle: <strong>async does not make anything faster. It makes waiting free of
  threads</strong>, and a service's capacity is set by how many operations it can have in flight, not
  by how fast any one of them is.</p>

  <p>That distinction explains why the feature is so easy to evaluate incorrectly. Measured with one
  request it does nothing — <em>correctly</em> nothing, at 123 ms both ways. Measured under load it
  is the difference between 104 milliseconds and 2.6 seconds. Neither measurement is wrong; they
  answer different questions, and only one of them is the question production asks.</p>

  <p>It also explains why "add more instances" is such an expensive wrong turn. Horizontal scaling
  buys more thread pools, and if each one is being wasted on threads that are waiting, you are paying
  for capacity you already had. The 25× above was recovered on the same hardware.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Async makes code faster."</strong> Measured identical at concurrency 1 — 123 ms both
    ways — and 25× better at 200. It buys capacity, never latency for a single operation.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Async means it runs on another thread."</strong> It means it runs on <em>no</em>
    thread while waiting. Measured: 1,000 concurrent operations on 12 OS threads, and CPU work
    queued during them ran in 27 ms on a pool of 8.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Marking a method <code>async</code> makes it concurrent."</strong> An async method
    with no suspension runs entirely on the calling thread before returning — measured, the call
    itself took 164 ms and returned a completed task.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>await</code> means in parallel."</strong> Three 200 ms operations awaited in
    sequence took <strong>613 ms</strong>; started first, <strong>202</strong>. Concurrency comes
    from starting, not from awaiting.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>Task.Run</code> makes CPU work async."</strong> It moves it to another thread.
    Measured 1.13× <em>slower</em> even with spare cores, and on a busy server it consumes the pool
    thread the rest of your requests need.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The method resumes on the thread it started on."</strong> Measured: entering on
    thread 2, resuming on 1001. Thread-affine state, <code>[ThreadStatic]</code>, and locks held
    across an <code>await</code> are all broken by this.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Our p99 is fine, so we are not queueing."</strong> Only if the clock starts before
    the queue. Measured: p99 of 125 ms during a run that took 2,649 ms, because the timer started
    after dequeue.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>Waiting on network, disk or a database</td><td><code>async</code>/<code>await</code>,
          all the way up</td>
          <td>1,000 concurrent waits on 12 threads instead of 1,012.</td></tr>
      <tr><td>Pure computation</td><td>Not async. Parallel if it is large enough</td>
          <td>Async measured 1.13–1.32× slower; parallelism measured 2.89× faster.</td></tr>
      <tr><td>Several independent I/O calls</td><td>Start them all, then
          <code>Task.WhenAll</code></td><td>202 ms against 613 for three operations.</td></tr>
      <tr><td>Many independent I/O calls</td><td><code>WhenAll</code> with a
          <code>SemaphoreSlim</code> bound</td>
          <td>Unbounded <code>WhenAll</code> over 10,000 items overwhelms the downstream.</td></tr>
      <tr><td>Calls that genuinely depend on each other</td><td>Await them in sequence</td>
          <td>Sequential is correct when the dependency is real; read the data flow.</td></tr>
      <tr><td>A method with nothing to await</td><td>Do not mark it <code>async</code></td>
          <td>A state machine and a task for no suspension.</td></tr>
      <tr><td>An interface demands a <code>Task</code> and you have nothing async</td>
          <td><code>Task.FromResult</code> / <code>ValueTask</code></td>
          <td>Satisfies the signature without the state machine.</td></tr>
      <tr><td>State that must flow through an operation</td><td><code>AsyncLocal&lt;T&gt;</code>,
          never <code>[ThreadStatic]</code></td>
          <td>The thread changes at every await — measured, 2 to 1001.</td></tr>
      <tr><td>Measuring whether async helped</td><td>Load-test at production concurrency</td>
          <td>At one request the answer is always "no difference", correctly.</td></tr>
      <tr><td>Instrumenting latency</td><td>Start the clock at the edge, not in the handler</td>
          <td>Otherwise queueing is invisible — p99 125 ms during a 2.6 s run.</td></tr>
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
    <p>Three operations, each 150 ms. Predict the elapsed time of each version.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>// (a)
await Task.Delay(150); await Task.Delay(150); await Task.Delay(150);

// (b)
var x = Task.Delay(150); var y = Task.Delay(150); var z = Task.Delay(150);
await Task.WhenAll(x, y, z);

// (c)
var x = Task.Delay(150); var y = Task.Delay(150); var z = Task.Delay(150);
await x; await y; await z;</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>(a) await, await, await                 :    466 ms
(b) start all three, then WhenAll       :    151 ms
(c) start all three, await one by one   :    152 ms</code></pre>
        <p><strong>(b) and (c) are the same</strong>, and that is the point of including (c).</p>
        <p>In (a), <code>Task.Delay(150)</code> is not <em>called</em> the second time until the first
        <code>await</code> has completed. Three sequential operations, three sequential waits.</p>
        <p>In (b) and (c), all three <code>Task.Delay</code> calls happen before any
        <code>await</code>. The operations are already running; by the time
        <code>await y</code> is reached in (c), <code>y</code> has been running for as long as
        <code>x</code> was awaited, so it completes almost immediately.</p>
        <p><strong>The rule: concurrency is created by starting, not by awaiting.</strong>
        <code>Task.WhenAll</code> is a convenience for waiting on several tasks and for aggregating
        their exceptions — it does not start anything, and (c) proves it by matching it without
        using it.</p>
        <p>One practical note on why <code>WhenAll</code> is still preferable to (c): if
        <code>x</code> throws, version (c) propagates that exception at <code>await x</code> and never
        awaits <code>y</code> or <code>z</code>, leaving them unobserved.
        <code>WhenAll</code> waits for all of them and aggregates the failures.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>An async method logs its thread id before and after a single <code>await</code>. What do you
    expect, and where was the thread during the wait?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>entering            : thread 2, pool=False
after await         : thread 7, pool=True
same thread?        : False
During the 50 ms no thread was assigned to this method at all.
It resumed on whichever pool thread was free.</code></pre>
        <p><strong>A different thread, and a pool one.</strong> The method entered on the main
        thread and resumed on a thread-pool thread.</p>
        <p><strong>Where was the thread during the 50 ms? There was not one.</strong> That is the
        answer the module exists to establish, and the strongest evidence for it is elsewhere in the
        verification code: with 1,000 operations mid-await, CPU work queued to the pool ran in 27 ms
        on <strong>8 threads</strong>. If those operations held threads, that work would have queued
        behind them.</p>
        <p>What actually happens at the <code>await</code>: the runtime packages the rest of the
        method as a continuation, registers it with the operating system's I/O notification
        mechanism, and returns the thread to the pool. When the timer fires, the continuation is
        queued as an ordinary work item and picked up by whichever thread is free.</p>
        <p><strong>Three consequences to remember</strong>, all of which follow from "the thread can
        change":</p>
        <ul>
          <li><code>[ThreadStatic]</code> state does not survive. Use
          <code>AsyncLocal&lt;T&gt;</code>, which flows with the logical operation instead.</li>
          <li>A <code>lock</code> cannot be held across an <code>await</code> — the compiler refuses
          with <code>CS1996</code>, because a monitor is owned by a thread and the continuation may
          resume on a different one.</li>
          <li>Anything keyed on <code>Thread.CurrentThread</code> — some legacy transaction or
          security contexts — is not a stable identity for a logical operation.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Does making a method async help? Measure a CPU-bound and an I/O-bound method, first with one
    caller and then with a hundred.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>CPU-bound, sync   :    162 ms
CPU-bound, async  :    168 ms  (1.04x)
I/O-bound, sync   :    202 ms
I/O-bound, async  :    202 ms  (1.00x)

100 concurrent, sync  :  2,435 ms
100 concurrent, async :    205 ms  (11.9x faster)</code></pre>
        <p><strong>With one caller, async helps neither.</strong> CPU-bound is marginally worse
        (1.04×, which is overhead); I/O-bound is identical to two decimal places.</p>
        <p><strong>With a hundred callers, the I/O case is 11.9× faster</strong> — and the CPU case
        would still be no better, because the limit there is cores rather than threads.</p>
        <p><strong>This is the experiment to run before any async migration</strong>, and the order
        matters. Measuring at concurrency 1 first tells you async will not fix a slow single
        operation, which is usually what someone hopes. Measuring at production concurrency tells you
        whether it will fix your capacity, which is what it actually does.</p>
        <p><strong>The decision rule it produces:</strong></p>
        <ul>
          <li>Slow with <em>one</em> user → async will not help. Look at the operation itself.</li>
          <li>Fine with one user, slow with many, CPU low → async, and this is the common case.</li>
          <li>Fine with one, slow with many, CPU high → you are out of cores. Async will not help;
          more machines or less work will.</li>
        </ul>
        <p>That third row is worth dwelling on, because it is the case where async is proposed and
        cannot possibly work. The measurement that distinguishes it is CPU during the slow run — and
        it takes seconds to check.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>This handler makes four calls: a customer lookup, a fraud check, an authorisation, and an
    audit write. It is fully async and takes the sum of all four. Make it faster without changing
    what it does.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 4"><code>await LookupCustomerAsync();   // 40 ms
await FraudCheckAsync();       // 40 ms  — needs nothing from the lookup
await AuthoriseAsync();        // 60 ms  — needs the customer
await WriteAuditAsync();       // 20 ms  — needs the authorisation</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>as written (four sequential awaits)   :    187 ms
with the independent calls overlapped :    141 ms
saving : 46 ms (1.32x)</code></pre>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>// The lookup and the fraud check do not depend on each other, so start both.
var customer = LookupCustomerAsync();
var fraud = FraudCheckAsync();
await Task.WhenAll(customer, fraud);

// Authorisation needs the customer, so it cannot start any earlier.
await AuthoriseAsync();

// The audit needs the authorisation.
await WriteAuditAsync();</code></pre>
        <p><strong>187 ms to 141.</strong> The saving is exactly the 40 ms fraud check, which now
        runs alongside the 40 ms lookup instead of after it.</p>
        <p><strong>The work is reading the dependencies, and async does not do it for you.</strong>
        The compiler cannot know that the fraud check does not need the customer record — that is a
        fact about your domain, and it is why this refactor cannot be automated.</p>
        <p><strong>Why the other two cannot move.</strong> Authorisation needs the customer, so it
        cannot start before the lookup completes. The audit records the authorisation's outcome, so
        it cannot start before that. The theoretical floor is 40 + 60 + 20 = 120 ms, and the measured
        141 is that plus scheduling overhead.</p>
        <p><strong>Two cautions before applying this everywhere.</strong></p>
        <p>Overlapping changes the failure semantics. In the sequential version, if the customer
        lookup fails the fraud check never runs. In the overlapped version it runs anyway, and if
        that check has a side effect — a rate-limit consumption, a charge, an audit entry — you have
        changed behaviour, not only timing.</p>
        <p>And it changes the load shape downstream. Two calls now leave simultaneously instead of
        sequentially, so a service that was seeing one request at a time from you now sees two.
        Across a fleet under load that is a real doubling of concurrent pressure, which is fine
        until it is not.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does <code>await</code> actually do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Suspends the method until the operation completes, and <strong>releases the thread while
        waiting</strong>. The release is the point — measured as 1,000 concurrent operations on 12
        OS threads instead of 1,012.</p>
      </div></details>
    </li>
    <li>
      <p>Where is the thread during an <code>await</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>There is not one.</strong> Proof: with 1,000 operations mid-await, CPU work queued
        to the pool started and finished in 27 ms on a pool of 8 threads.</p>
      </div></details>
    </li>
    <li>
      <p>Does async make a single request faster?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No, and it never will.</strong> Measured identical at concurrency 1 — 123 ms both
        ways. It buys capacity: 25× better at concurrency 200.</p>
      </div></details>
    </li>
    <li>
      <p>What does an <code>async</code> method with no <code>await</code> do?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Runs entirely on the calling thread, to completion, before returning. Measured: the call
        took 164 ms and returned an already-completed task.</p>
      </div></details>
    </li>
    <li>
      <p>What creates concurrency?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Starting operations, not awaiting them.</strong> Three 200 ms operations: 613 ms
        awaited in sequence, 202 ms started first. <code>WhenAll</code> starts nothing.</p>
      </div></details>
    </li>
    <li>
      <p>Should CPU-bound work be async?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. Measured <strong>1.13× to 1.32× slower</strong> — there is no I/O to overlap, so only
        the overhead remains. Parallelism is the tool for CPU work: 2.89× across 8 logical
        processors.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>Task.Run</code> on a request path usually wrong?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It takes a second pool thread to do CPU work while the request's own thread waits — two
        threads where one was needed, and the pool is the contended resource.</p>
      </div></details>
    </li>
    <li>
      <p>Does a method resume on the thread it started on?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — measured, thread 2 to thread 1001. So <code>[ThreadStatic]</code> does not survive, a
        <code>lock</code> cannot span an <code>await</code> (<code>CS1996</code>), and
        <code>AsyncLocal&lt;T&gt;</code> is the tool for flowing state.</p>
      </div></details>
    </li>
    <li>
      <p>Your p99 says 125 ms and users report seconds. What is the first thing to check?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Where the clock starts.</strong> A timer inside the handler cannot see queueing —
        measured as p99 125 ms during a run that took 2,649 ms.</p>
      </div></details>
    </li>
    <li>
      <p>A service is slow under load with low CPU. Async or more machines?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Async.</strong> Low CPU means threads are waiting, and more machines buy more
        thread pools to waste the same way. The 25× above was recovered on the same hardware.</p>
      </div></details>
    </li>
    <li>
      <p>When will async definitely not help?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When it is slow with a single user (the operation itself is slow), or when it is slow
        under load with CPU <em>high</em> (you are out of cores). Async only addresses threads spent
        waiting.</p>
      </div></details>
    </li>
    <li>
      <p>What does converting a handler to async change about a single request's latency?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Nothing.</strong> Verified in the incident above and at concurrency 1. What changes
        is the shape under load: 2,649 ms to 104 at concurrency 200.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
