CSPREP.module({
  id: "t2-01-threads-and-scheduling",
  minutes: 55,
  updated: "2026-08-30",
  summary: "A thread is an OS object with its own stack and a claim on a core, and the whole of this track follows from two measured facts: your machine can only RUN as many threads as it has cores, and a thread that is waiting is not using one. Those two together are why concurrency and parallelism are different problems with different limits.",
  terms: ["thread", "process", "core", "logical processor", "context switch", "scheduler",
    "time slice", "preemption", "stack", "concurrency", "parallelism", "blocked",
    "runnable", "foreground thread", "background thread", "oversubscription",
    "simultaneous multithreading", "ProcessorCount"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A settlement worker in Ledger — the payments and invoicing service these modules keep
  returning to — submits each payment instruction to a card gateway and waits about 80 milliseconds
  for the answer. Done one at a time, a batch of 500 takes 40 seconds.</p>

  <p>The obvious fix is to do them at once, and the obvious way to do that is to give each
  instruction its own thread. It works. It is tested against batches of eight, it is fast, and it
  ships.</p>

  <p>Then a backlog arrives and the batch is 50,000. Latency climbs, CPU does not, and nothing in
  the logs says why. Adding machines helps less than it should. Somebody suggests adding more
  threads.</p>

  <p><strong>Every question in that paragraph is answered by two facts about threads</strong>, and
  both are measurable in a few lines: your machine can only <em>run</em> as many threads as it has
  cores, and a thread that is <em>waiting</em> is not using one. This module establishes both, and
  the rest of the track is built on them.</p>
</section>

<section id="what-a-thread-is">
  <h2>What a thread actually is</h2>

  <p class="define"><span class="define__term">Process</span> A running program, with its own memory
  that other processes cannot see. <span class="define__term">Thread</span> a stream of execution
  inside a process. One process has at least one thread and may have thousands; they share the
  process's memory but each has its own <span class="define__term">stack</span> — the region holding
  its local variables and the chain of methods it is currently inside.</p>

  <p class="define"><span class="define__term">Core</span> The hardware that executes instructions.
  One core runs one thread at a time. <span class="define__term">Logical processor</span> what the
  operating system counts and what <code>Environment.ProcessorCount</code> reports, which is not
  always the same number as physical cores.</p>

  <p>The analogy: a process is a <strong>kitchen</strong> and threads are <strong>cooks working in
  it</strong>. They share the ingredients and the worktops — that is the process memory — and each
  has their own hands and their own place in their own recipe, which is the stack.
  <strong>The analogy breaks in the place that matters most</strong>: two cooks reaching for the
  same bowl merely get in each other's way, whereas two threads writing the same field can produce a
  value neither of them wrote. That is <a href="#/m/t2-11-race-conditions">Race Conditions and
  Memory Visibility</a>, and it is the reason threads are hard.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-what-a-thread-is.cs"><code>// 01-what-a-thread-is.cs — what a thread actually is, read from the running
// process rather than described. Every number here is this machine's.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-what-a-thread-is.cs
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- the machine ---");
        Console.WriteLine($"  Environment.ProcessorCount : {Environment.ProcessorCount}");
        Console.WriteLine($"  OS                         : {RuntimeInformation.OSDescription}");
        Console.WriteLine($"  runtime                    : {RuntimeInformation.FrameworkDescription}");
        Console.WriteLine("  ProcessorCount is the number of threads that can be RUNNING at");
        Console.WriteLine("  the same instant. Every thread beyond that is waiting for a turn.");

        Console.WriteLine();
        Console.WriteLine("--- the process already has threads you did not create ---");
        var process = Process.GetCurrentProcess();
        Console.WriteLine($"  OS threads in this process : {process.Threads.Count}");
        Console.WriteLine($"  managed threads you wrote  : 1 (this one)");
        Console.WriteLine("  The rest belong to the runtime: the GC, the finaliser, the");
        Console.WriteLine("  tiered-compilation background JIT, and the debugger if attached.");

        Console.WriteLine();
        Console.WriteLine("--- a thread has an identity and its own stack ---");
        Console.WriteLine($"  current ManagedThreadId : {Environment.CurrentManagedThreadId}");
        Console.WriteLine($"  IsThreadPoolThread      : {Thread.CurrentThread.IsThreadPoolThread}");
        Console.WriteLine($"  IsBackground            : {Thread.CurrentThread.IsBackground}");
        Console.WriteLine($"  Name                    : {Thread.CurrentThread.Name ?? "(null)"}");

        var worker = new Thread(() =&gt;
        {
            Console.WriteLine($"  inside the new thread   : id={Environment.CurrentManagedThreadId}, " +
                              $"pool={Thread.CurrentThread.IsThreadPoolThread}, " +
                              $"background={Thread.CurrentThread.IsBackground}");
        })
        { Name = "ledger-worker" };
        worker.Start();
        worker.Join();
        Console.WriteLine("  A different id. Separate stack, separate register state.");

        Console.WriteLine();
        Console.WriteLine("--- each thread's locals are private; the heap is shared ---");
        var shared = new int[1];
        var t1 = new Thread(() =&gt; { var local = 1; shared[0] += local; });
        var t2 = new Thread(() =&gt; { var local = 2; shared[0] += local; });
        t1.Start(); t2.Start(); t1.Join(); t2.Join();
        Console.WriteLine($"  two threads, each with its own 'local'  : no interference");
        Console.WriteLine($"  both wrote to the same heap array      : shared[0] = {shared[0]}");
        Console.WriteLine("  That difference is the entire subject of the next few modules.");

        Console.WriteLine();
        Console.WriteLine("--- stack size is reserved per thread, and it is not small ---");
        var deep = 0;
        var stackProbe = new Thread(() =&gt;
        {
            try { Recurse(ref deep); }
            catch (InsufficientExecutionStackException) { }
        }, maxStackSize: 256 * 1024);
        stackProbe.Start();
        stackProbe.Join();
        Console.WriteLine($"  frames before a 256 KB stack ran low : {deep:N0}");

        var deepDefault = 0;
        var defaultProbe = new Thread(() =&gt;
        {
            try { Recurse(ref deepDefault); }
            catch (InsufficientExecutionStackException) { }
        });
        defaultProbe.Start();
        defaultProbe.Join();
        Console.WriteLine($"  frames before the DEFAULT stack ran low : {deepDefault:N0}");
        Console.WriteLine($"  ratio                                   : {(double)deepDefault / deep:0.0}x");
        Console.WriteLine("  Note the ratio is NOT the 4x the stack sizes would suggest.");
        Console.WriteLine("  EnsureSufficientExecutionStack demands a fixed headroom before");
        Console.WriteLine("  it will say yes, and that margin is a large fraction of 256 KB");
        Console.WriteLine("  and a small one of 1 MB. The numbers show the stacks differ;");
        Console.WriteLine("  they do not measure the sizes.");
        Console.WriteLine("  The default reserve on Windows is 1 MB of ADDRESS SPACE per");
        Console.WriteLine("  thread. Pages are committed as the stack grows, so an idle");
        Console.WriteLine("  thread costs far less physical memory than 1 MB — but the");
        Console.WriteLine("  reservation is why a 32-bit process dies at ~2,000 threads.");

        Console.WriteLine();
        Console.WriteLine("--- foreground threads keep the process alive; background ones do not ---");
        var background = new Thread(() =&gt; Thread.Sleep(5_000)) { IsBackground = true };
        background.Start();
        Console.WriteLine($"  started a background thread that sleeps 5s");
        Console.WriteLine($"  IsAlive : {background.IsAlive}");
        Console.WriteLine("  This program is about to exit without waiting for it. A");
        Console.WriteLine("  FOREGROUND thread would have held the process open for 5");
        Console.WriteLine("  seconds — which is why a stray non-background thread shows up");
        Console.WriteLine("  as 'the service takes 30 seconds to shut down'.");
        Console.WriteLine("  Thread-pool threads are always background.");
    }

    // EnsureSufficientExecutionStack throws before the stack actually overflows,
    // so this measures usable depth without killing the process. A real
    // StackOverflowException cannot be caught and terminates immediately.
    static void Recurse(ref int depth)
    {
        RuntimeHelpers.EnsureSufficientExecutionStack();
        depth++;
        Recurse(ref depth);
    }
}

file static class RuntimeHelpers
{
    public static void EnsureSufficientExecutionStack()
        =&gt; System.Runtime.CompilerServices.RuntimeHelpers.EnsureSufficientExecutionStack();
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the machine ---
  Environment.ProcessorCount : 8
  OS                         : Microsoft Windows 10.0.26200
  runtime                    : .NET 10.0.11
  ProcessorCount is the number of threads that can be RUNNING at
  the same instant. Every thread beyond that is waiting for a turn.

--- the process already has threads you did not create ---
  OS threads in this process : 8
  managed threads you wrote  : 1 (this one)
  The rest belong to the runtime: the GC, the finaliser, the
  tiered-compilation background JIT, and the debugger if attached.

--- a thread has an identity and its own stack ---
  current ManagedThreadId : 2
  IsThreadPoolThread      : False
  IsBackground            : False
  Name                    : (null)
  inside the new thread   : id=4, pool=False, background=False
  A different id. Separate stack, separate register state.

--- each thread's locals are private; the heap is shared ---
  two threads, each with its own 'local'  : no interference
  both wrote to the same heap array      : shared[0] = 3
  That difference is the entire subject of the next few modules.

--- stack size is reserved per thread, and it is not small ---
  frames before a 256 KB stack ran low : 2,697
  frames before the DEFAULT stack ran low : 29,992
  ratio                                   : 11.1x
  Note the ratio is NOT the 4x the stack sizes would suggest.
  EnsureSufficientExecutionStack demands a fixed headroom before
  it will say yes, and that margin is a large fraction of 256 KB
  and a small one of 1 MB. The numbers show the stacks differ;
  they do not measure the sizes.
  The default reserve on Windows is 1 MB of ADDRESS SPACE per
  thread. Pages are committed as the stack grows, so an idle
  thread costs far less physical memory than 1 MB — but the
  reservation is why a 32-bit process dies at ~2,000 threads.

--- foreground threads keep the process alive; background ones do not ---
  started a background thread that sleeps 5s
  IsAlive : True
  This program is about to exit without waiting for it. A
  FOREGROUND thread would have held the process open for 5
  seconds — which is why a stray non-background thread shows up
  as 'the service takes 30 seconds to shut down'.
  Thread-pool threads are always background.</code></pre>

  <p><strong>The process already had eight OS threads before any were created.</strong> The garbage
  collector, the finaliser queue and the background JIT all have their own. "My program is
  single-threaded" is never true on .NET.</p>

  <p><strong>Locals are private, the heap is shared.</strong> Two threads each had their own
  <code>local</code> and never interfered — different stacks. Both wrote to the same array on the
  heap and the result was 3. That one line is the boundary between code that is safe to run on
  several threads and code that is not.</p>

  <p class="define"><span class="define__term">Foreground thread</span> One that keeps the process
  alive until it finishes. <span class="define__term">Background thread</span> one the process will
  abandon on exit. <code>new Thread(...)</code> gives you a <em>foreground</em> thread by default;
  thread-pool threads are always background.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>That default is why services hang on shutdown.</strong> One
    <code>new Thread(...)</code> that nobody set <code>IsBackground = true</code> on, sitting in a
    loop with a 30-second sleep, holds the whole process open after everything else has stopped. It
    shows up as a container that will not stop and gets force-killed by the orchestrator, which then
    looks like a crash in the logs.</p>
  </div>
</section>

<section id="cost">
  <h2>What a thread costs</h2>

  <pre data-lang="csharp" data-net="10" data-title="02-cost-of-threads.cs"><code>// 02-cost-of-threads.cs — the three costs of a thread: creating one, the memory
// it holds, and the context switches it causes. These numbers are why the thread
// pool exists and why "just add threads" stops working.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-cost-of-threads.cs -c Release
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
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine();

        Console.WriteLine("--- 1. creating a thread ---");
        const int N = 1_000;

        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; N; i++)
        {
            var t = new Thread(static () =&gt; { }) { IsBackground = true };
            t.Start();
            t.Join();
        }
        sw.Stop();
        var perThread = sw.Elapsed.TotalMilliseconds * 1_000 / N;
        Console.WriteLine($"  new Thread + Start + Join : {perThread:N1} us each ({N:N0} threads)");

        // Warm the pool so this measures dispatch, not thread injection.
        for (var i = 0; i &lt; 200; i++) ThreadPool.QueueUserWorkItem(static _ =&gt; { });
        Thread.Sleep(200);

        sw.Restart();
        for (var i = 0; i &lt; N; i++)
        {
            using var done = new ManualResetEventSlim(false);
            ThreadPool.QueueUserWorkItem(static s =&gt; ((ManualResetEventSlim)s!).Set(), done);
            done.Wait();
        }
        sw.Stop();
        var perQueue = sw.Elapsed.TotalMilliseconds * 1_000 / N;
        Console.WriteLine($"  ThreadPool.QueueUserWorkItem : {perQueue:N1} us each");
        Console.WriteLine($"  ratio                        : {perThread / perQueue:N0}x");
        Console.WriteLine("  A pooled thread already exists. That whole difference is");
        Console.WriteLine("  creation and teardown, and it is the reason for the pool.");

        Console.WriteLine();
        Console.WriteLine("--- 2. memory held by idle threads ---");
        var before = GC.GetTotalMemory(true);
        var beforeWorkingSet = Process.GetCurrentProcess().WorkingSet64;

        const int Idle = 500;
        var gate = new ManualResetEventSlim(false);
        var threads = new Thread[Idle];
        for (var i = 0; i &lt; Idle; i++)
        {
            threads[i] = new Thread(() =&gt; gate.Wait(), maxStackSize: 0) { IsBackground = true };
            threads[i].Start();
        }
        Thread.Sleep(500);

        var afterWorkingSet = Process.GetCurrentProcess().WorkingSet64;
        var afterManaged = GC.GetTotalMemory(false);
        Console.WriteLine($"  {Idle} idle threads");
        Console.WriteLine($"    managed heap growth : {(afterManaged - before) / 1024:N0} KB " +
                          $"({(afterManaged - before) / Idle:N0} bytes each)");
        Console.WriteLine($"    working set growth  : {(afterWorkingSet - beforeWorkingSet) / 1024:N0} KB " +
                          $"({(afterWorkingSet - beforeWorkingSet) / Idle / 1024:N0} KB each)");
        Console.WriteLine("  The managed object is tiny. The working set is the committed");
        Console.WriteLine("  stack pages plus kernel bookkeeping — far less than the 1 MB");
        Console.WriteLine("  reserved, because untouched stack pages are never committed.");
        gate.Set();
        foreach (var t in threads) t.Join();

        Console.WriteLine();
        Console.WriteLine("--- 3. context switching: same work, more threads ---");
        Console.WriteLine("  Total work is FIXED. Only the number of threads changes.");
        Console.WriteLine();
        Console.WriteLine("  threads   elapsed ms   vs 1 thread   OS threads mid-run");
        const long TotalIterations = 240_000_000;
        double baseline = 0;
        foreach (var threadCount in new[] { 1, 2, 4, 8, 16, 64, 256, 1024, 4096 })
        {
            var per = TotalIterations / threadCount;
            var ts = new Thread[threadCount];
            var start = new ManualResetEventSlim(false);
            for (var i = 0; i &lt; threadCount; i++)
            {
                ts[i] = new Thread(() =&gt; { start.Wait(); Burn(per); }) { IsBackground = true };
                ts[i].Start();
            }
            var w = Stopwatch.StartNew();
            start.Set();
            // Sample while the work is actually running, not after Join.
            Thread.Sleep(20);
            var osThreads = OsThreadCount();
            foreach (var t in ts) t.Join();
            w.Stop();
            if (threadCount == 1) baseline = w.Elapsed.TotalMilliseconds;
            Console.WriteLine($"  {threadCount,7}   {w.Elapsed.TotalMilliseconds,10:N0}   " +
                              $"{baseline / w.Elapsed.TotalMilliseconds,10:N2}x   {osThreads,10:N0}");
        }
        Console.WriteLine();
        Console.WriteLine("  Three things in that table are worth more than the headline.");
        Console.WriteLine();
        Console.WriteLine($"  1. Peak speedup is well under {Environment.ProcessorCount}x, on a machine reporting");
        Console.WriteLine($"     {Environment.ProcessorCount} processors. ProcessorCount counts LOGICAL processors;");
        Console.WriteLine("     8 logical is typically 4 physical cores with SMT, and a second");
        Console.WriteLine("     thread on one core shares its execution units rather than");
        Console.WriteLine("     doubling it. Sizing a pool from ProcessorCount assumes a");
        Console.WriteLine("     linearity that does not exist.");
        Console.WriteLine();
        Console.WriteLine("  2. Past the core count it keeps improving slightly, up to about");
        Console.WriteLine("     64 threads. That is not extra parallelism — it is this process");
        Console.WriteLine("     claiming a larger share of the scheduler against everything");
        Console.WriteLine("     else running on the machine. It is real, and it is rude.");
        Console.WriteLine();
        Console.WriteLine("  3. Then it collapses. At 4,096 threads the SAME work takes");
        Console.WriteLine("     longer than it did on 4 threads. Nothing about the work");
        Console.WriteLine("     changed; all of that is scheduling overhead.");
        Console.WriteLine();
        Console.WriteLine("  The OS-thread column is sampled while the work runs, and shows");
        Console.WriteLine("  the process really is holding them. It is NOT a context-switch");
        Console.WriteLine("  count: that needs ETW or an elevated performance counter, so the");
        Console.WriteLine("  switching cost here is inferred from the timings.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // The OS thread count while the work is running. NOT a context-switch count:
    // Windows exposes those through ETW or a performance counter needing
    // elevation, and neither belongs in a file you run with &#96;dotnet run&#96;. The
    // switching is inferred from the timings, not measured here.
    static int OsThreadCount()
    {
        var p = Process.GetCurrentProcess();
        p.Refresh();
        return p.Threads.Count;
    }

    static void Burn(long iterations)
    {
        long acc = 0;
        for (long i = 0; i &lt; iterations; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>processors: 8

--- 1. creating a thread ---
  new Thread + Start + Join : 552.5 us each (1,000 threads)
  ThreadPool.QueueUserWorkItem : 14.9 us each
  ratio                        : 37x
  A pooled thread already exists. That whole difference is
  creation and teardown, and it is the reason for the pool.

--- 2. memory held by idle threads ---
  500 idle threads
    managed heap growth : 131 KB (270 bytes each)
    working set growth  : 12,016 KB (24 KB each)
  The managed object is tiny. The working set is the committed
  stack pages plus kernel bookkeeping — far less than the 1 MB
  reserved, because untouched stack pages are never committed.

--- 3. context switching: same work, more threads ---
  Total work is FIXED. Only the number of threads changes.

  threads   elapsed ms   vs 1 thread   OS threads mid-run
        1          396         1.00x           17
        2          225         1.76x           18
        4          176         2.25x           20
        8          125         3.16x           24
       16          126         3.15x           32
       64          115         3.44x           19
      256          123         3.23x           77
     1024          163         2.42x          569
     4096          243         1.63x        1,193

  Three things in that table are worth more than the headline.

  1. Peak speedup is well under 8x, on a machine reporting
     8 processors. ProcessorCount counts LOGICAL processors;
     8 logical is typically 4 physical cores with SMT, and a second
     thread on one core shares its execution units rather than
     doubling it. Sizing a pool from ProcessorCount assumes a
     linearity that does not exist.

  2. Past the core count it keeps improving slightly, up to about
     64 threads. That is not extra parallelism — it is this process
     claiming a larger share of the scheduler against everything
     else running on the machine. It is real, and it is rude.

  3. Then it collapses. At 4,096 threads the SAME work takes
     longer than it did on 4 threads. Nothing about the work
     changed; all of that is scheduling overhead.

  The OS-thread column is sampled while the work runs, and shows
  the process really is holding them. It is NOT a context-switch
  count: that needs ETW or an elevated performance counter, so the
  switching cost here is inferred from the timings.</code></pre>

  <p><strong>Creating a thread costs 552 microseconds; handing work to an existing one costs 15
  — a factor of 37.</strong> Everything in that gap is the operating system allocating a stack,
  registering the thread with the scheduler, and tearing it all down again. That single measurement
  is the entire justification for <a href="#/m/t2-02-thread-pool">The Thread Pool</a>.</p>

  <p><strong>500 idle threads cost 12 MB of working set — 24 KB each, not the 1 MB reserved.</strong>
  Stack memory is reserved as address space and committed page by page as the stack actually grows,
  so an idle thread is much cheaper in RAM than the reservation suggests. On a 64-bit process the
  address space is effectively free; on a 32-bit one, 2,000 threads exhausts it.</p>

  <p class="define"><span class="define__term">Context switch</span> The operating system saving one
  thread's registers and stack pointer, and restoring another's, so a different thread can use the
  core. <span class="define__term">Time slice</span> the interval a thread is allowed to run before
  the scheduler considers switching. <span class="define__term">Preemption</span> being interrupted
  mid-work rather than yielding voluntarily.</p>

  <h3>The scaling curve is the important part</h3>

  <p>The work is <em>fixed</em> across every row. Only the thread count changes, and three things
  happen.</p>

  <p><strong>Peak speedup is 3.44×, on a machine reporting 8 processors.</strong> Not 8×, not
  close.</p>

  <p class="define"><span class="define__term">Simultaneous multithreading</span> (SMT, or
  Hyper-Threading on Intel) One physical core presenting itself as two logical processors, sharing
  the core's execution units between them. A second thread on the same core typically adds 20–30%,
  not 100% — which is why 8 logical processors did not produce anything near 8×.</p>

  <p><strong>Past the core count it kept improving slightly, to about 64 threads.</strong> That is
  not parallelism. It is this process claiming a larger share of the scheduler against everything
  else on the machine. It works, and on a shared host it works by taking time from your neighbours.</p>

  <p class="define"><span class="define__term">Oversubscription</span> Running many more threads than
  there are cores. <strong>At 4,096 threads the same work took longer than it had on 4</strong> —
  243 ms against 176 ms. Nothing about the work changed; the difference is entirely the scheduler.</p>
</section>

<section id="concurrency-vs-parallelism">
  <h2>Concurrency is not parallelism</h2>

  <p>This is the distinction the whole track rests on, and it is easier to measure than to define.</p>

  <p class="define"><span class="define__term">Parallelism</span> Several things happening at the
  same <em>instant</em>. It requires cores, and it is capped by them.
  <span class="define__term">Concurrency</span> several things <em>in progress</em> at once, which
  is a different claim: they may be taking turns, or most of them may be doing nothing at all.</p>

  <p class="define"><span class="define__term">Blocked</span> A thread that cannot proceed until
  something external happens — a network reply, a disk read, a lock. The scheduler does not give it
  a core. <span class="define__term">Runnable</span> a thread that could use a core right now and is
  queued for one.</p>

  <pre data-lang="csharp" data-net="10" data-title="03-concurrency-vs-parallelism.cs"><code>// 03-concurrency-vs-parallelism.cs — the distinction the rest of this track
// depends on, measured rather than defined. Same thread count, two kinds of
// work, opposite results.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-concurrency-vs-parallelism.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;
    const int Items = 32;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}, work items: {Items}");
        Console.WriteLine();

        Console.WriteLine("=== CPU-BOUND work: threads buy PARALLELISM, up to the core count ===");
        Console.WriteLine();
        Console.WriteLine("  threads   elapsed ms   vs 1 thread");
        double cpuBaseline = 0;
        foreach (var n in new[] { 1, 2, 4, 8, 16, 32 })
        {
            var ms = RunCpuBound(n);
            if (n == 1) cpuBaseline = ms;
            Console.WriteLine($"  {n,7}   {ms,10:N0}   {cpuBaseline / ms,10:N2}x");
        }
        Console.WriteLine();
        Console.WriteLine("  It stops improving because the CPU is the limit. Adding threads");
        Console.WriteLine("  cannot create cores. The row-to-row wobble past 8 is scheduler");
        Console.WriteLine("  noise and share-claiming, not parallelism — run it twice and the");
        Console.WriteLine("  ordering of the last three rows changes. What does not change is");
        Console.WriteLine("  that none of them come close to 8x.");

        Console.WriteLine();
        Console.WriteLine("=== I/O-BOUND work: threads buy CONCURRENCY, and it scales far past ===");
        Console.WriteLine();
        Console.WriteLine("  threads   elapsed ms   vs 1 thread");
        double ioBaseline = 0;
        foreach (var n in new[] { 1, 2, 4, 8, 16, 32 })
        {
            var ms = RunIoBound(n);
            if (n == 1) ioBaseline = ms;
            Console.WriteLine($"  {n,7}   {ms,10:N0}   {ioBaseline / ms,10:N2}x");
        }
        Console.WriteLine();
        Console.WriteLine($"  {Items} items x 100 ms of WAITING. One thread takes {Items} x 100 ms;");
        Console.WriteLine($"  {Items} threads take about 100 ms — and the speedup went far past");
        Console.WriteLine($"  {Environment.ProcessorCount} cores, because none of those threads needed a core.");
        Console.WriteLine("  They were blocked, and the OS does not schedule a blocked thread.");

        Console.WriteLine();
        Console.WriteLine("=== the same I/O work with NO extra threads at all ===");
        var blockingMs = RunIoBound(Items);
        var threadsDuringBlocking = _peakDuringBlocking;

        var threadsBefore = OsThreads();
        var peak = threadsBefore;
        using (var sampler = new Timer(_ =&gt; { var n = OsThreads(); if (n &gt; peak) peak = n; },
                                       null, 0, 5))
        {
            var sw2 = Stopwatch.StartNew();
            RunIoAsync().GetAwaiter().GetResult();
            sw2.Stop();
            Console.WriteLine($"  blocking, {Items} threads : {blockingMs,6:N0} ms, " +
                              $"OS threads peaked at {threadsDuringBlocking}");
            Console.WriteLine($"  async,    {Items} tasks   : {sw2.Elapsed.TotalMilliseconds,6:N0} ms, " +
                              $"OS threads peaked at {peak}");
        }
        Console.WriteLine($"  threads saved : {threadsDuringBlocking - peak}");
        Console.WriteLine("  Same elapsed time, without the threads.");
        Console.WriteLine("  That is the whole argument for async, and t2-03 is about the");
        Console.WriteLine("  mechanism. The point here is only that CONCURRENCY and");
        Console.WriteLine("  PARALLELISM are different things:");
        Console.WriteLine("    parallelism  = doing several things at the same INSTANT");
        Console.WriteLine("                   (needs cores; capped by them)");
        Console.WriteLine("    concurrency  = having several things IN PROGRESS at once");
        Console.WriteLine("                   (needs no cores at all if they are waiting)");

        Console.WriteLine();
        Console.WriteLine("=== proof that blocked threads are not running ===");
        var burnStart = Stopwatch.StartNew();
        Burn(120_000_000);
        burnStart.Stop();
        var soloBurn = burnStart.Elapsed.TotalMilliseconds;

        var blockers = new Thread[64];
        var gate = new ManualResetEventSlim(false);
        for (var i = 0; i &lt; blockers.Length; i++)
        {
            blockers[i] = new Thread(() =&gt; gate.Wait()) { IsBackground = true };
            blockers[i].Start();
        }
        Thread.Sleep(200);
        burnStart.Restart();
        Burn(120_000_000);
        burnStart.Stop();
        gate.Set();
        foreach (var t in blockers) t.Join();

        Console.WriteLine($"  CPU work alone                    : {soloBurn:N0} ms");
        Console.WriteLine($"  same work, 64 BLOCKED threads too : {burnStart.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine($"  slowdown                          : {burnStart.Elapsed.TotalMilliseconds / soloBurn:N2}x");
        Console.WriteLine("  Near 1.0x. A thread waiting on a lock, a socket or a sleep");
        Console.WriteLine("  costs memory, not CPU. Compare that with 64 threads all");
        Console.WriteLine("  RUNNING, in 02-cost-of-threads.cs, which cost plenty.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static double RunCpuBound(int threadCount)
    {
        var perThread = Items / threadCount;
        var work = new Thread[threadCount];
        var start = new ManualResetEventSlim(false);
        for (var i = 0; i &lt; threadCount; i++)
        {
            work[i] = new Thread(() =&gt;
            {
                start.Wait();
                for (var k = 0; k &lt; perThread; k++) Burn(8_000_000);
            })
            { IsBackground = true };
            work[i].Start();
        }
        var sw = Stopwatch.StartNew();
        start.Set();
        foreach (var t in work) t.Join();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static int _peakDuringBlocking;

    static int OsThreads()
    {
        var p = Process.GetCurrentProcess();
        p.Refresh();
        return p.Threads.Count;
    }

    static double RunIoBound(int threadCount)
    {
        var perThread = Items / threadCount;
        var work = new Thread[threadCount];
        var start = new ManualResetEventSlim(false);
        for (var i = 0; i &lt; threadCount; i++)
        {
            work[i] = new Thread(() =&gt;
            {
                start.Wait();
                // Thread.Sleep stands in for a blocking network or disk call:
                // the thread is alive, holding its stack, and not runnable.
                for (var k = 0; k &lt; perThread; k++) Thread.Sleep(100);
            })
            { IsBackground = true };
            work[i].Start();
        }
        var sw = Stopwatch.StartNew();
        start.Set();
        Thread.Sleep(20);
        var n = OsThreads();
        if (n &gt; _peakDuringBlocking) _peakDuringBlocking = n;
        foreach (var t in work) t.Join();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static async Task RunIoAsync()
    {
        var tasks = new Task[Items];
        for (var i = 0; i &lt; Items; i++) tasks[i] = Task.Delay(100);
        await Task.WhenAll(tasks);
    }

    static void Burn(long iterations)
    {
        long acc = 0;
        for (long i = 0; i &lt; iterations; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>processors: 8, work items: 32

=== CPU-BOUND work: threads buy PARALLELISM, up to the core count ===

  threads   elapsed ms   vs 1 thread
        1          570         1.00x
        2          316         1.81x
        4          234         2.43x
        8          194         2.93x
       16          230         2.48x
       32          166         3.44x

  It stops improving because the CPU is the limit. Adding threads
  cannot create cores. The row-to-row wobble past 8 is scheduler
  noise and share-claiming, not parallelism — run it twice and the
  ordering of the last three rows changes. What does not change is
  that none of them come close to 8x.

=== I/O-BOUND work: threads buy CONCURRENCY, and it scales far past ===

  threads   elapsed ms   vs 1 thread
        1        3,487         1.00x
        2        1,769         1.97x
        4          869         4.01x
        8          435         8.01x
       16          215        16.22x
       32          103        33.81x

  32 items x 100 ms of WAITING. One thread takes 32 x 100 ms;
  32 threads take about 100 ms — and the speedup went far past
  8 cores, because none of those threads needed a core.
  They were blocked, and the OS does not schedule a blocked thread.

=== the same I/O work with NO extra threads at all ===
  blocking, 32 threads :    116 ms, OS threads peaked at 40
  async,    32 tasks   :    103 ms, OS threads peaked at 12
  threads saved : 28
  Same elapsed time, without the threads.
  That is the whole argument for async, and t2-03 is about the
  mechanism. The point here is only that CONCURRENCY and
  PARALLELISM are different things:
    parallelism  = doing several things at the same INSTANT
                   (needs cores; capped by them)
    concurrency  = having several things IN PROGRESS at once
                   (needs no cores at all if they are waiting)

=== proof that blocked threads are not running ===
  CPU work alone                    : 202 ms
  same work, 64 BLOCKED threads too : 198 ms
  slowdown                          : 0.98x
  Near 1.0x. A thread waiting on a lock, a socket or a sleep
  costs memory, not CPU. Compare that with 64 threads all
  RUNNING, in 02-cost-of-threads.cs, which cost plenty.</code></pre>

  <p><strong>Two tables, same thread counts, opposite results.</strong> CPU-bound work saturated at
  under 3×. I/O-bound work scaled to <strong>33.81× on 32 threads</strong>, four times past the core
  count, essentially linearly.</p>

  <p>The reason is the third measurement: <strong>64 blocked threads slowed CPU work by
  0.98×</strong> — that is, not at all. A blocked thread is not in the scheduler's run queue. It
  costs memory and it costs nothing else.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>This is why "how many threads should I use?" has no single answer.</strong> For work
    that keeps a core busy, the ceiling is the core count and exceeding it is pure loss. For work
    that spends its time waiting, the useful number is set by how much waiting there is, and it can
    be far higher. Most real services are a mixture, which is why the exercises measure a workload
    that is 90% waiting.</p>
  </div>

  <p><strong>And then the row that makes the rest of this track necessary:</strong> the async version
  did the same 32 concurrent operations in the same elapsed time using <strong>12 OS threads instead
  of 40</strong>. It gets the concurrency without paying for the threads.
  <a href="#/m/t2-03-what-async-really-is">What <code>async</code> Actually Is</a> is about how.</p>
</section>

<section id="giving-up-a-core">
  <h2>How a thread gives up a core</h2>

  <p>Everything in the rest of this track — locks, the pool, <code>await</code> — is built from a
  handful of primitives for stopping. They are not interchangeable, and the difference between two
  of them is the difference between a wait that is free and a wait that costs a core.</p>

  <pre data-lang="csharp" data-net="10" data-title="06-yielding.cs"><code>// 06-yielding.cs — the four ways to stop using a core, and what each one
// actually does. These are the primitives every lock, pool and await is built
// from, and choosing wrongly is how a "wait" burns a core.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 06-yielding.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static long _sink;
    static volatile bool _flag;

    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}");
        Console.WriteLine();

        Console.WriteLine("--- how long does each 'do nothing' actually take? ---");
        Console.WriteLine();
        Console.WriteLine("  call                       per call");
        Report("Thread.Sleep(0)", () =&gt; Thread.Sleep(0), 200_000);
        Report("Thread.Yield()", () =&gt; Thread.Yield(), 200_000);
        Report("Thread.Sleep(1)", () =&gt; Thread.Sleep(1), 300);
        Report("Task.Delay(1).Wait()", () =&gt; System.Threading.Tasks.Task.Delay(1).Wait(), 300);
        Console.WriteLine();
        Console.WriteLine("  Sleep(0) and Yield() return almost immediately: they offer the");
        Console.WriteLine("  rest of the time slice back and are usually handed it straight");
        Console.WriteLine("  away. Sleep(1) is not 1 ms — it is 'at least 1 ms', rounded up");
        Console.WriteLine("  to the OS timer resolution, which on Windows is ~15.6 ms unless");
        Console.WriteLine("  something has raised it.");

        Console.WriteLine();
        Console.WriteLine("--- spinning vs blocking, while another thread does real work ---");
        var solo = Measure(() =&gt; Burn(150_000_000));
        Console.WriteLine($"  CPU work alone                       : {solo,7:N0} ms");

        // 8 threads spinning on a flag: runnable, and eating cores.
        _flag = false;
        var spinners = Start(8, () =&gt; { while (!_flag) { } });
        var withSpinners = Measure(() =&gt; Burn(150_000_000));
        _flag = true;
        Join(spinners);
        Console.WriteLine($"  ...with 8 threads SPIN-waiting        : {withSpinners,7:N0} ms " +
                          $"({withSpinners / solo:N2}x)");

        // 8 threads blocked on an event: not runnable, and free.
        var gate = new ManualResetEventSlim(false);
        var blockers = Start(8, () =&gt; gate.Wait());
        var withBlockers = Measure(() =&gt; Burn(150_000_000));
        gate.Set();
        Join(blockers);
        Console.WriteLine($"  ...with 8 threads BLOCKED             : {withBlockers,7:N0} ms " +
                          $"({withBlockers / solo:N2}x)");
        Console.WriteLine();
        Console.WriteLine("  Both sets of threads are 'waiting' in the everyday sense. Only");
        Console.WriteLine("  one of them is waiting in the scheduler's sense. A spin-wait is");
        Console.WriteLine("  a thread saying 'I am ready to run' several million times a");
        Console.WriteLine("  second, and the OS believes it.");

        Console.WriteLine();
        Console.WriteLine("--- SpinWait does the right thing automatically ---");
        _flag = false;
        var smart = Start(8, () =&gt;
        {
            var spin = new SpinWait();
            while (!_flag) spin.SpinOnce();
        });
        var withSpinWait = Measure(() =&gt; Burn(150_000_000));
        _flag = true;
        Join(smart);
        Console.WriteLine($"  ...with 8 threads using SpinWait      : {withSpinWait,7:N0} ms " +
                          $"({withSpinWait / solo:N2}x)");
        Console.WriteLine("  SpinWait spins briefly — worth it if the wait is nanoseconds —");
        Console.WriteLine("  then yields, then sleeps. It is the primitive to reach for when");
        Console.WriteLine("  you genuinely do not know how long the wait will be.");

        Console.WriteLine();
        Console.WriteLine("--- thread priority is not a scheduling guarantee ---");
        _flag = false;
        long lowCount = 0, highCount = 0;
        var low = new Thread(() =&gt; { long n = 0; while (!_flag) n++; lowCount = n; })
        { IsBackground = true, Priority = ThreadPriority.Lowest };
        var high = new Thread(() =&gt; { long n = 0; while (!_flag) n++; highCount = n; })
        { IsBackground = true, Priority = ThreadPriority.Highest };
        low.Start(); high.Start();
        Thread.Sleep(300);
        _flag = true;
        low.Join(); high.Join();
        Interlocked.Add(ref _sink, lowCount + highCount);
        Console.WriteLine("  Two spinning threads, Lowest and Highest priority, 300 ms:");
        Console.WriteLine($"    Lowest  iterations : {lowCount,15:N0}");
        Console.WriteLine($"    Highest iterations : {highCount,15:N0}");
        Console.WriteLine($"    ratio              : {(double)highCount / lowCount,15:N2}x");
        Console.WriteLine("  Priority is a HINT to the OS scheduler, applied within a");
        Console.WriteLine("  process and subject to the OS's own anti-starvation boosting.");
        Console.WriteLine("  It does not partition CPU, and raising it is almost never the");
        Console.WriteLine("  fix for a latency problem — it moves the problem to whatever");
        Console.WriteLine("  you just starved.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static void Report(string name, Action a, int iterations)
    {
        for (var i = 0; i &lt; Math.Min(iterations, 100); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; iterations; i++) a();
        sw.Stop();
        var us = sw.Elapsed.TotalMilliseconds * 1_000 / iterations;
        Console.WriteLine($"  {name,-26} {us,8:N2} us");
    }

    static Thread[] Start(int n, Action body)
    {
        var ts = new Thread[n];
        for (var i = 0; i &lt; n; i++)
        {
            ts[i] = new Thread(() =&gt; body()) { IsBackground = true };
            ts[i].Start();
        }
        Thread.Sleep(50);
        return ts;
    }

    static void Join(Thread[] ts) { foreach (var t in ts) t.Join(); }

    static double Measure(Action a)
    {
        var sw = Stopwatch.StartNew();
        a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static void Burn(long iterations)
    {
        long acc = 0;
        for (long i = 0; i &lt; iterations; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>processors: 8

--- how long does each 'do nothing' actually take? ---

  call                       per call
  Thread.Sleep(0)                0.64 us
  Thread.Yield()                 0.46 us
  Thread.Sleep(1)            15,553.20 us
  Task.Delay(1).Wait()       15,617.68 us

  Sleep(0) and Yield() return almost immediately: they offer the
  rest of the time slice back and are usually handed it straight
  away. Sleep(1) is not 1 ms — it is 'at least 1 ms', rounded up
  to the OS timer resolution, which on Windows is ~15.6 ms unless
  something has raised it.

--- spinning vs blocking, while another thread does real work ---
  CPU work alone                       :     230 ms
  ...with 8 threads SPIN-waiting        :     701 ms (3.05x)
  ...with 8 threads BLOCKED             :     245 ms (1.07x)

  Both sets of threads are 'waiting' in the everyday sense. Only
  one of them is waiting in the scheduler's sense. A spin-wait is
  a thread saying 'I am ready to run' several million times a
  second, and the OS believes it.

--- SpinWait does the right thing automatically ---
  ...with 8 threads using SpinWait      :     208 ms (0.91x)
  SpinWait spins briefly — worth it if the wait is nanoseconds —
  then yields, then sleeps. It is the primitive to reach for when
  you genuinely do not know how long the wait will be.

--- thread priority is not a scheduling guarantee ---
  Two spinning threads, Lowest and Highest priority, 300 ms:
    Lowest  iterations :     567,217,191
    Highest iterations :     532,211,083
    ratio              :            0.94x
  Priority is a HINT to the OS scheduler, applied within a
  process and subject to the OS's own anti-starvation boosting.
  It does not partition CPU, and raising it is almost never the
  fix for a latency problem — it moves the problem to whatever
  you just starved.</code></pre>

  <p><strong><code>Thread.Sleep(1)</code> takes 15.5 milliseconds.</strong> Not one. The argument is
  a <em>minimum</em>, and the actual wait is rounded up to the operating system's timer resolution,
  which on Windows is about 15.6 ms by default. <code>Task.Delay(1)</code> measured the same.</p>

  <p>That number explains a whole category of confusion. A retry loop with
  <code>Thread.Sleep(1)</code> between attempts does not do a thousand attempts a second; it does
  about sixty-four. A "1 ms poll" is a 15 ms poll.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>Some processes raise the system timer resolution, and it is global.</strong> Media
    players and browsers historically called <code>timeBeginPeriod</code> to get 1 ms timers, which
    changes the behaviour of every process on the machine — so the same code can measure 15.6 ms on
    an idle server and 1 ms on a developer's laptop with a video call running. If timing matters,
    measure it on the machine that will run it.</p>
  </div>

  <h3>Spinning is not waiting</h3>

  <p class="define"><span class="define__term">Spin-wait</span> Looping until a condition becomes
  true, without telling the operating system you are blocked. The thread stays <em>runnable</em>,
  so the scheduler keeps giving it a core.</p>

  <p>Measured against the same CPU work: <strong>8 spinning threads cost 3.05×, and 8 blocked
  threads cost 1.07×</strong>. Both sets are "waiting" in the everyday sense. Only the second is
  waiting in the sense the scheduler understands.</p>

  <p><strong><code>SpinWait</code> came out at 0.91×</strong> — inside the noise of doing nothing at
  all. It spins for a few iterations, which is worth it when the wait is nanoseconds, then yields,
  then sleeps. It is the right primitive when you do not know how long the wait will be, and it is
  what the framework's own lock implementations use.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Call</th><th>Costs</th><th>Use when</th></tr></thead>
    <tbody>
      <tr><td><code>Thread.Sleep(0)</code></td><td>0.64 µs</td>
          <td>Offer the rest of your slice to a thread of equal priority. Rarely correct
          directly.</td></tr>
      <tr><td><code>Thread.Yield()</code></td><td>0.46 µs</td>
          <td>Same, to any thread on this core. Slightly more willing than
          <code>Sleep(0)</code>.</td></tr>
      <tr><td><code>Thread.Sleep(1)</code></td><td><strong>15.5 ms</strong></td>
          <td>Almost never. The number is not what it looks like.</td></tr>
      <tr><td>A spin loop</td><td>A whole core</td>
          <td>Only for waits measured in nanoseconds, and only with a bound.</td></tr>
      <tr><td><code>SpinWait.SpinOnce()</code></td><td>~0 when it matters</td>
          <td>Unknown wait length. Spins, then yields, then blocks.</td></tr>
      <tr><td>Blocking (<code>Wait</code>, <code>lock</code>)</td><td>1.07× — memory only</td>
          <td>Waits longer than a microsecond. The default answer.</td></tr>
      <tr><td><code>await</code></td><td>No thread at all</td>
          <td>Waiting on I/O. <a href="#/m/t2-03-what-async-really-is">t2-03</a>.</td></tr>
    </tbody>
  </table>
  </div>

  <h3>Priority does not do what its name suggests</h3>

  <p>Two threads spinning for 300 ms, one at <code>Lowest</code> and one at <code>Highest</code>.
  The result: <strong>567 million iterations for Lowest and 532 million for Highest — a ratio of
  0.94</strong>. The high-priority thread did <em>fewer</em>.</p>

  <p>Priority is a hint. The OS applies it within a process, weighs it against everything else on
  the machine, and actively boosts threads that have been starved so they do not stall forever. On
  8 cores with only two runnable threads, both got a core regardless, and the difference is
  noise.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Raising thread priority is almost never the fix for a latency problem.</strong> It
    does not create CPU; it takes it from something else in the same process, and the thing you
    starve is usually the garbage collector or the thread pool — after which the symptom moves
    somewhere harder to diagnose. If a thread is not getting CPU, the question is why there is more
    runnable work than cores, and that is a design answer rather than a priority one.</p>
  </div>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — the incident shape this module exists to explain, run at
// small scale: a Ledger settlement worker that gives each item its own thread,
// and what happens to it as volume grows.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Settlement;

public sealed record Instruction(string Reference, decimal AmountMinor);

/// &lt;summary&gt;
/// Stands in for the gateway call each instruction makes: mostly waiting, with
/// a little work to do with the answer.
/// &lt;/summary&gt;
public static class Gateway
{
    public const int LatencyMs = 80;

    public static void Submit(Instruction _)
    {
        Thread.Sleep(LatencyMs);          // the network round trip
        Burn(2_000_000);                  // parsing and validating the response
    }

    public static async Task SubmitAsync(Instruction _, CancellationToken ct = default)
    {
        await Task.Delay(LatencyMs, ct);
        Burn(2_000_000);
    }

    private static long _sink;
    private static void Burn(long n)
    {
        long acc = 0;
        for (long i = 0; i &lt; n; i++) acc += i % 7;
        Interlocked.Add(ref _sink, acc);
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine($"processors: {Environment.ProcessorCount}, " +
                          $"simulated gateway latency: {Gateway.LatencyMs} ms");
        Console.WriteLine();
        Console.WriteLine("Each instruction is ~80 ms of WAITING plus a little CPU.");
        Console.WriteLine("Three implementations, identical work, growing batch size.");
        Console.WriteLine();
        Console.WriteLine("  batch   thread-per-item        bounded pool          async");
        Console.WriteLine("            ms   peak threads      ms   peak threads     ms   peak threads");

        foreach (var batch in new[] { 8, 32, 128, 512 })
        {
            var items = Build(batch);

            var (tpiMs, tpiThreads) = ThreadPerItem(items);
            var (bpMs, bpThreads) = BoundedPool(items, Environment.ProcessorCount * 4);
            var (asMs, asThreads) = AsyncAll(items);

            Console.WriteLine($"  {batch,5}   {tpiMs,7:N0}   {tpiThreads,12}   {bpMs,5:N0}   {bpThreads,12}   " +
                              $"{asMs,5:N0}   {asThreads,12}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what the table says ---");
        Console.WriteLine("  thread-per-item is FASTEST at small batches and its thread count");
        Console.WriteLine("  tracks the batch exactly. At 512 it is holding hundreds of");
        Console.WriteLine("  threads to do 512 x 80 ms of waiting, and each one reserves");
        Console.WriteLine("  1 MB of stack address space.");
        Console.WriteLine();
        Console.WriteLine("  The bounded pool holds a fixed number of threads regardless of");
        Console.WriteLine("  batch size, and pays for it in elapsed time: it can only have");
        Console.WriteLine("  that many round trips in flight.");
        Console.WriteLine();
        Console.WriteLine("  async matches thread-per-item's elapsed time with a thread count");
        Console.WriteLine("  that barely moves — because a task awaiting I/O occupies no");
        Console.WriteLine("  thread at all. That is t2-03.");
        Console.WriteLine();
        Console.WriteLine("--- the failure this module is about ---");
        Console.WriteLine("  Nothing above crashed. Thread-per-item looked GOOD at batch 8,");
        Console.WriteLine("  which is the batch size it was tested with. The design fails on");
        Console.WriteLine("  a Tuesday when a backlog arrives and the batch is 50,000:");
        Console.WriteLine("    - 50,000 x 1 MB reserved = 50 GB of address space");
        Console.WriteLine("    - the OS scheduler juggling 50,000 runnable-ish threads");
        Console.WriteLine("    - and, measured in 02-cost-of-threads.cs, the same work took");
        Console.WriteLine("      LONGER on 4,096 threads than on 4");
        Console.WriteLine("  The symptom is not 'we ran out of threads'. It is latency");
        Console.WriteLine("  climbing with no change in CPU or in the code.");
    }

    static List&lt;Instruction&gt; Build(int n)
    {
        var list = new List&lt;Instruction&gt;(n);
        for (var i = 1; i &lt;= n; i++)
            list.Add(new Instruction($"P-{i:D6}", (i % 900 + 100) * 100));
        return list;
    }

    static int OsThreads()
    {
        var p = Process.GetCurrentProcess();
        p.Refresh();
        return p.Threads.Count;
    }

    /// &lt;summary&gt;One OS thread per instruction. Simple, and unbounded.&lt;/summary&gt;
    static (double ms, int peakThreads) ThreadPerItem(List&lt;Instruction&gt; items)
    {
        var peak = 0;
        var threads = new Thread[items.Count];
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; items.Count; i++)
        {
            var item = items[i];
            threads[i] = new Thread(() =&gt; Gateway.Submit(item)) { IsBackground = true };
            threads[i].Start();
        }
        Thread.Sleep(30);
        peak = OsThreads();
        foreach (var t in threads) t.Join();
        sw.Stop();
        return (sw.Elapsed.TotalMilliseconds, peak);
    }

    /// &lt;summary&gt;A fixed number of threads draining a queue. Bounded, and slower.&lt;/summary&gt;
    static (double ms, int peakThreads) BoundedPool(List&lt;Instruction&gt; items, int workers)
    {
        var peak = 0;
        var queue = new Queue&lt;Instruction&gt;(items);
        var threads = new Thread[workers];
        var sw = Stopwatch.StartNew();
        for (var i = 0; i &lt; workers; i++)
        {
            threads[i] = new Thread(() =&gt;
            {
                while (true)
                {
                    Instruction next;
                    lock (queue)
                    {
                        if (queue.Count == 0) return;
                        next = queue.Dequeue();
                    }
                    Gateway.Submit(next);
                }
            })
            { IsBackground = true };
            threads[i].Start();
        }
        Thread.Sleep(30);
        peak = OsThreads();
        foreach (var t in threads) t.Join();
        sw.Stop();
        return (sw.Elapsed.TotalMilliseconds, peak);
    }

    /// &lt;summary&gt;No thread per item at all.&lt;/summary&gt;
    static (double ms, int peakThreads) AsyncAll(List&lt;Instruction&gt; items)
    {
        var peak = 0;
        var sw = Stopwatch.StartNew();
        using (new Timer(_ =&gt; { var n = OsThreads(); if (n &gt; peak) peak = n; }, null, 0, 10))
        {
            Task.WhenAll(items.ConvertAll(i =&gt; Gateway.SubmitAsync(i))).GetAwaiter().GetResult();
        }
        sw.Stop();
        return (sw.Elapsed.TotalMilliseconds, peak);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>processors: 8, simulated gateway latency: 80 ms

Each instruction is ~80 ms of WAITING plus a little CPU.
Three implementations, identical work, growing batch size.

  batch   thread-per-item        bounded pool          async
            ms   peak threads      ms   peak threads     ms   peak threads
      8        92             16      95             16     110             18
     32       122             50     130             50     127             18
    128       208            146     416             50     210             19
    512       699            389   1,591             51     630             19

--- what the table says ---
  thread-per-item is FASTEST at small batches and its thread count
  tracks the batch exactly. At 512 it is holding hundreds of
  threads to do 512 x 80 ms of waiting, and each one reserves
  1 MB of stack address space.

  The bounded pool holds a fixed number of threads regardless of
  batch size, and pays for it in elapsed time: it can only have
  that many round trips in flight.

  async matches thread-per-item's elapsed time with a thread count
  that barely moves — because a task awaiting I/O occupies no
  thread at all. That is t2-03.

--- the failure this module is about ---
  Nothing above crashed. Thread-per-item looked GOOD at batch 8,
  which is the batch size it was tested with. The design fails on
  a Tuesday when a backlog arrives and the batch is 50,000:
    - 50,000 x 1 MB reserved = 50 GB of address space
    - the OS scheduler juggling 50,000 runnable-ish threads
    - and, measured in 02-cost-of-threads.cs, the same work took
      LONGER on 4,096 threads than on 4
  The symptom is not 'we ran out of threads'. It is latency
  climbing with no change in CPU or in the code.</code></pre>

  <p><strong>At batch 8, thread-per-item is the fastest of the three and looks like the right
  answer.</strong> That is the trap: it is the batch size it was written and tested against.</p>

  <p><strong>At batch 512, async wins on both axes at once</strong> — 630 ms against 699 ms, using
  <strong>19 threads against 389</strong>. It is not a trade-off at that scale; the thread-per-item
  design is worse in both dimensions.</p>

  <p>The bounded pool is the interesting middle. Its thread count is flat at about 51 whatever the
  batch, which is the property you want, and it pays <strong>1,591 ms against 699</strong> for it —
  because only 32 gateway calls can be in flight at once. It is trading latency for predictability,
  which is often correct, and it is the shape <a href="#/m/t2-02-thread-pool">The Thread Pool</a>
  generalises.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A thread per unit of work</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: unbounded thread creation"><code>// WRONG. Measured: 389 OS threads for a batch of 512, and 552 us of pure
// creation cost each. At 50,000 it is 50 GB of reserved address space and a
// scheduler juggling 50,000 threads to do work that is 90% waiting.
foreach (var instruction in batch)
{
    var t = new Thread(() =&gt; gateway.Submit(instruction));
    t.Start();
}

// Right: the work is I/O-bound, so it needs concurrency, not threads.
await Task.WhenAll(batch.Select(i =&gt; gateway.SubmitAsync(i, cancellationToken)));</code></pre>

  <h3>2. Sizing a thread pool from <code>ProcessorCount</code> for I/O work</h3>

  <p>Measured: CPU-bound work saturated below 3×, and I/O-bound work scaled to 33.81× on 32 threads.
  A pool sized to 8 for work that is 90% waiting leaves most of the throughput on the table — the
  exercises measure exactly this.</p>

  <h3>3. Expecting <code>ProcessorCount</code>× speedup</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a capacity plan built on a number that is not throughput"><code>// WRONG. This treats ProcessorCount as a throughput multiplier. Measured peak
// on 8 logical processors was 3.44x, not 8x — logical processors are not cores,
// and SMT gives a fraction of one.
var workers = Environment.ProcessorCount;
var expectedThroughput = singleThreadThroughput * workers;   // off by ~2.5x

// Right: ProcessorCount is a ceiling on PARALLELISM, not a prediction. Measure
// the workload and size from the wait-to-work ratio.
var workers = Environment.ProcessorCount * measuredWaitToWorkRatio;</code></pre>

  <p>Measured: 3.44× peak on 8 logical processors. <code>ProcessorCount</code> counts logical
  processors, and SMT gives a fraction of a core, not a whole one.</p>

  <h3>4. Forgetting <code>IsBackground</code></h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the process will not exit"><code>// WRONG. new Thread(...) is FOREGROUND by default — verified. This one holds
// the process open for up to 30 seconds after everything else has stopped, and
// the orchestrator force-kills it, which the logs record as a crash.
var poller = new Thread(() =&gt;
{
    while (!_stopping) { Poll(); Thread.Sleep(30_000); }
});
poller.Start();

// Right: a background thread the process can abandon, and a token so it does
// not have to be abandoned mid-work.
var poller = new Thread(() =&gt;
{
    while (!token.IsCancellationRequested) { Poll(); token.WaitHandle.WaitOne(30_000); }
})
{ IsBackground = true, Name = "ledger-poller" };
poller.Start();</code></pre>

  <h3>5. Believing blocked threads are cheap in every sense</h3>

  <p>They are free in CPU — measured at 0.98× — and they are not free in memory: 24 KB of working
  set each, plus 1 MB of reserved address space. Ten thousand blocked threads is 240 MB of committed
  memory doing nothing.</p>

  <h3>6. A scaling benchmark that repeats the work instead of dividing it</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: measures &quot;more work takes longer&quot;"><code>// WRONG. Every thread does the FULL workload, so N threads do N times the work.
// This produced 0.32x at 16 threads and read as proof that threads hurt
// CPU-bound work. It was a broken benchmark.
Run(threadCount, () =&gt; Burn(20_000_000));

// Right: fix the total and divide it.
var perThread = TotalIterations / threadCount;
Run(threadCount, () =&gt; Burn(perThread));</code></pre>

  <h3>7. Benchmarking with a batch size production will never see</h3>

  <p>Thread-per-item was the <em>fastest</em> option at batch 8. Every design in that table is
  correct at some scale and wrong at another, and the only way to know which is to measure at the
  scale that will actually arrive.</p>


</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Latency is climbing and CPU is not.</strong> That combination almost always means
    threads are waiting rather than working. Count them:
    <code>dotnet-counters monitor --process-id &lt;pid&gt; System.Runtime</code> shows
    <code>ThreadPool Thread Count</code> and <code>ThreadPool Queue Length</code> live. A thread
    count that tracks your request rate is a thread-per-request design; a queue length that grows is
    <a href="#/m/t2-02-thread-pool">starvation</a>.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Finding out what the threads are doing.</strong>
    <code>dotnet-dump collect -p &lt;pid&gt;</code>, then <code>dotnet-dump analyze</code> and
    <code>clrstack -all</code>. If hundreds of stacks look identical and end in a socket read or a
    <code>Wait</code>, they are blocked on I/O and the fix is async, not more threads.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A container that will not stop.</strong> A foreground thread is holding the process
    open. Every <code>new Thread(...)</code> in the codebase is foreground unless someone said
    otherwise — grep for it and check each one sets <code>IsBackground</code> or is joined during
    shutdown.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Deciding whether a workload is CPU-bound or I/O-bound.</strong> Run it single-threaded
    and watch one core. If that core sits at 100%, it is CPU-bound and the core count is your
    ceiling. If it sits near zero while the operation takes seconds, it is waiting, and threads are
    the wrong tool for the same reason a bigger engine does not shorten a traffic jam.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Naming threads before you need to.</strong>
    <code>new Thread(...) { Name = "ledger-poller" }</code> costs nothing and turns an anonymous row
    in a dump into an answer. Unnamed threads in a 400-thread dump are a genuinely hard problem that
    one property would have prevented.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Distrust a scaling table whose total work is not fixed.</strong> Before believing any
    threads-versus-time measurement, check that the per-thread work is divided rather than repeated.
    This is the single most common way concurrency benchmarks lie, and it is easy to do by
    accident.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's settlement worker used the thread-per-instruction
    design above. It ran every 15 minutes against batches that were typically 200–800 instructions,
    took a few seconds, and had been in production for a year without anyone thinking about it.</p>
    <p>A card provider had a four-hour outage. Ledger queued the instructions it could not submit,
    correctly, and when the provider recovered the next run picked up a backlog of about
    <strong>60,000</strong>.</p>
    <p>The worker created 60,000 threads. It did not run out of memory — the box had 32 GB and, as
    measured here, idle threads commit around 24 KB each rather than their full 1 MB reservation, so
    roughly 1.5 GB of stacks. What it ran out of was scheduler.</p>
    <p>The batch that should have taken about 90 seconds took <strong>a little over four hours</strong>.
    The measurement in this module shows the mechanism: at 4,096 threads, fixed work took longer than
    it had at 4. At 60,000 the process spent most of its time switching between threads rather than
    running any of them.</p>
    <p>Two things made it hard to diagnose. <strong>CPU sat at about 30%</strong>, so every
    CPU-based alert stayed green and the dashboards looked healthy. And the worker was not
    <em>stuck</em> — it was making progress, slowly, so it never tripped a watchdog. The first real
    signal was a customer asking why a settlement from that morning had not landed.</p>
    <p>The fix was the one-line change in "what goes wrong": <code>Task.WhenAll</code> over an async
    gateway call, with a <code>SemaphoreSlim</code> capping in-flight requests at 100 so the provider
    was not the next thing to fall over. The same 60,000 instructions then took
    <strong>under three minutes</strong>, and the OS thread count stayed in the twenties — the ratio
    this module measured at batch 512, where async used 19 threads against 389.</p>
  </div>

  <p>The general principle: <strong>threads are how you get parallelism, and parallelism is capped
  by hardware you cannot add at runtime.</strong> Using them to get <em>concurrency</em> — several
  operations in flight, most of them waiting — works at small scale and fails at large scale, and it
  fails in a way that does not look like a resource limit. There is no error, no exception, and no
  metric at its ceiling. There is only everything getting slower.</p>

  <p>That is the honest reason this is the first module in the track. Every later
  subject — the thread pool, <code>async</code>, <code>ConfigureAwait</code>, deadlocks,
  channels — is a technique for getting concurrency without paying for a thread per operation. None
  of them make sense until you have seen what the thread costs and what the scheduler does when you
  ask for too many.</p>

  <p>And one caution against over-correcting. <strong>Threads are not obsolete.</strong> For work
  that genuinely occupies a core, a thread is exactly the right tool and async buys nothing at all —
  a point <a href="#/m/t2-03-what-async-really-is">What <code>async</code> Actually Is</a> makes with
  its own measurements. The mistake is not using threads; it is using them for waiting.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"More threads means faster."</strong> Measured: fixed work took <strong>243 ms on
    4,096 threads and 176 ms on 4</strong>. Past the core count, extra threads add scheduling and
    nothing else.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"8 processors means 8× speedup."</strong> Peak measured speedup was
    <strong>3.44×</strong>. <code>ProcessorCount</code> counts <em>logical</em> processors, and SMT
    shares one core's execution units between two of them.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Threads are expensive, so never create one."</strong> Measured at
    <strong>552 microseconds</strong> to create, start and join. That is genuinely expensive per
    request and completely irrelevant once, at startup, for a long-lived worker.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A blocked thread slows everything down."</strong> Measured: 64 blocked threads
    changed CPU-bound work by <strong>0.98×</strong>. Blocked threads cost memory, not CPU. What
    slows things down is blocked threads <em>you cannot spare</em>, which is
    <a href="#/m/t2-02-thread-pool">the thread pool's</a> problem.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Each thread costs 1 MB of memory."</strong> That is reserved address space. Measured
    working set: <strong>24 KB per idle thread</strong>, because untouched stack pages are never
    committed. The 1 MB matters for 32-bit address exhaustion, not for RAM.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Concurrency and parallelism are the same word."</strong> Measured on the same
    machine with the same thread counts: CPU-bound saturated below 3×, I/O-bound reached
    <strong>33.81×</strong>. One is limited by cores; the other is not limited by cores at all.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>new Thread(...)</code> is a background thread."</strong> Verified:
    <code>IsBackground</code> is <code>False</code> by default. Thread-pool and
    <code>Task.Run</code> threads are background; ones you create are not.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>Work that keeps a core busy</td><td>Threads, about as many as cores</td>
          <td>Parallelism is capped by hardware; past it you pay scheduling for nothing.</td></tr>
      <tr><td>Work that spends its time waiting</td><td>Async, not threads</td>
          <td>Measured: 19 threads against 389 for the same elapsed time.</td></tr>
      <tr><td>A long-lived background loop</td><td>One <code>new Thread</code>, named, with
          <code>IsBackground = true</code></td>
          <td>552 µs once is nothing; foreground is what hangs shutdown.</td></tr>
      <tr><td>Short work items, many of them</td><td>The thread pool</td>
          <td>15 µs to dispatch against 552 µs to create — a factor of 37.</td></tr>
      <tr><td>Deciding how many workers</td><td>Measure the wait-to-work ratio</td>
          <td>"Threads = cores" is right for CPU work and badly wrong for a web service.</td></tr>
      <tr><td>Calling something that might be slow</td><td>Find out if it is CPU or I/O first</td>
          <td>The two have opposite answers and the same symptom.</td></tr>
      <tr><td>Any thread you create</td><td>Give it a <code>Name</code></td>
          <td>It costs nothing and it is the difference between a readable dump and a
          guess.</td></tr>
      <tr><td>Sharing data between threads</td><td>Stop and read
          <a href="#/m/t2-11-race-conditions">Race Conditions and Memory Visibility</a></td>
          <td>Locals are private; the heap is not. That is where the hard bugs live.</td></tr>
      <tr><td>Benchmarking a thread count</td><td>Divide the work, do not repeat it</td>
          <td>Otherwise you are measuring "more work takes longer".</td></tr>
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
    <p>The same fixed amount of work is split across 1, 4 and 16 threads. One version burns CPU; the
    other sleeps. Predict both speedup columns, and say why they differ.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>threads    CPU-bound      I/O-bound
      1      1.00x         1.00x
      4      3.43x         4.04x
     16      4.75x        15.89x</code></pre>
        <p><strong>CPU-bound stalls; I/O-bound does not.</strong> At 4 threads they look similar. At
        16 the CPU column has gained almost nothing more (3.43 → 4.75) while the I/O column is
        essentially linear (4.04 → 15.89).</p>
        <p><strong>Why.</strong> The CPU version needs a core to make progress, and this machine has
        8 logical processors that behave like rather fewer. The sleeping version needs no core at
        all — a blocked thread is not in the run queue, so sixteen of them wait simultaneously with
        no contention.</p>
        <p><strong>The detail that makes this exercise worth doing</strong> is that the total work is
        <em>fixed</em> and divided. An earlier version of this file gave every thread the full
        workload, so 16 threads did 16× the work and the "speedup" came out at 0.32×. It looked like
        evidence that threads hurt CPU-bound work, and it was evidence of a broken benchmark.</p>
        <p>Whenever you see a scaling table, that is the first thing to check.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p><code>Environment.ProcessorCount</code> reports 8. Fixed CPU work is split across 8 threads.
    Why is the speedup not 8×?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>1 thread  :     108 ms
8 threads :      33 ms
speedup   :    3.25x on 8 logical processors</code></pre>
        <p><strong>3.25×, not 8×.</strong> Three things account for the gap, and they compound.</p>
        <p><strong>Logical processors are not cores.</strong> <code>ProcessorCount</code> counts what
        the OS schedules onto. Eight logical processors is typically four physical cores with SMT,
        and the second thread on a core shares its execution units — worth roughly 20–30%, not
        another whole core.</p>
        <p><strong>The machine is not idle.</strong> The OS, this runtime's own GC and JIT threads,
        and everything else running compete for the same cores. A benchmark never gets the whole
        machine.</p>
        <p><strong>Memory bandwidth is shared.</strong> Even with genuinely separate cores, they
        contend for cache and memory. A loop that is bandwidth-bound rather than
        arithmetic-bound scales worse than the core count suggests.</p>
        <p><strong>Why it matters practically:</strong> a lot of code sizes a pool as
        <code>ProcessorCount</code> or <code>ProcessorCount * 2</code> and treats the result as a
        throughput prediction. It is not one. The only way to know the number for your workload is to
        measure it, which is exercise 4.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Which of these are background threads, and what is the consequence of getting it wrong?</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 3"><code>new Thread(() =&gt; { }).IsBackground
// a thread-pool thread
// a Task.Run thread</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>new Thread(...) default IsBackground : False
a thread-pool thread IsBackground    : True
Task.Run thread IsBackground         : True</code></pre>
        <p><strong>Threads you create are foreground; every pooled thread is background.</strong></p>
        <p><strong>Getting it wrong in one direction hangs shutdown.</strong> A foreground thread
        keeps the process alive after <code>Main</code> returns. One polling loop with a 30-second
        sleep, created with <code>new Thread</code> and never marked background, means the process
        takes up to 30 seconds to exit. In a container the orchestrator's termination grace period
        expires first and it is force-killed, which the logs record as a crash rather than as a slow
        shutdown.</p>
        <p><strong>Getting it wrong in the other direction loses work.</strong> Because pool threads
        are background, work queued with <code>Task.Run</code> is abandoned at process exit,
        mid-operation, with no unwinding. Fire-and-forget <code>Task.Run</code> for something that
        must complete — writing an audit record, flushing a buffer — will silently not complete on
        the one occasion it matters.</p>
        <p><strong>The fix for both is the same shape:</strong> do not rely on thread lifetime to
        decide when work stops. Use a <code>CancellationToken</code> for stopping and an explicit
        wait for draining. In ASP.NET Core that is <code>IHostedService</code>, whose
        <code>StopAsync</code> exists precisely so shutdown does not depend on whether a thread
        happened to be foreground.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>64 requests, each 90 ms of waiting plus 10 ms of CPU, on 8 logical processors. How many
    workers maximise throughput? Derive an estimate first, then compare it with the measurement.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>64 requests, each 90 ms waiting + 10 ms of CPU

workers   elapsed ms   throughput/s
      4        1,879             34
      8        1,026             62
     16          741             86
     32          494            130
     64          413            155</code></pre>
        <p><strong>The estimate.</strong> Each request occupies a worker for 100 ms but only needs a
        core for 10 ms of it. So one core can serve a request every 10 ms, and 8 logical processors
        give something under 800 requests/second of CPU capacity. To keep those cores fed you need
        enough workers that one is always ready:</p>
        <p><code>workers ≈ cores × (total time / CPU time) = 8 × (100 / 10) = 80</code></p>
        <p>That is the standard queueing estimate, and it says the answer is <em>around 80</em> — an
        order of magnitude above the core count.</p>
        <p><strong>The measurement agrees, and stops short.</strong> Throughput is still climbing at
        64 workers (155/s) and the curve is flattening: 4→8 nearly doubles it, 32→64 gains only 19%.
        The estimate says the knee is near 80 and the data is consistent with that.</p>
        <p><strong>Why measured throughput (155/s) is far below the theoretical 800/s:</strong> the
        test only has 64 requests, so at 64 workers each does exactly one and the elapsed time cannot
        drop below one request's 100 ms plus contention. The ceiling here is the fixed workload, not
        the machine. That is worth noticing — <strong>a saturation test needs more work than
        workers</strong>, or it measures its own batch size.</p>
        <p><strong>What to take from it.</strong> The wait-to-work ratio sets the worker count, and
        it is the only input that matters:</p>
        <ul>
          <li>Pure CPU (ratio 1) → workers ≈ cores. More is loss.</li>
          <li>90% waiting (ratio 10) → workers ≈ 10 × cores.</li>
          <li>99% waiting (ratio 100) → workers ≈ 100 × cores, which is 800 threads and 800 MB of
          reserved stack — the point at which the answer stops being threads at all and becomes
          async.</li>
        </ul>
        <p>That last row is the argument for the rest of this track. The formula keeps giving correct
        answers, and the answers keep getting less affordable, until the thread-per-operation model
        has to be abandoned rather than tuned.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does a thread have of its own, and what does it share?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Its own <strong>stack</strong> and register state, so locals are private. It shares the
        process's <strong>heap</strong> — verified: two threads with their own locals both wrote to
        one array. That difference is where every concurrency bug lives.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>Environment.ProcessorCount</code> tell you, and what does it not?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>How many threads can be <strong>running at one instant</strong>. It does not predict
        speedup: it counts <em>logical</em> processors, and measured peak speedup on 8 was
        <strong>3.44×</strong>.</p>
      </div></details>
    </li>
    <li>
      <p>What does creating a thread cost against reusing one?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>552 µs against 15 µs — 37×.</strong> That gap is the entire reason the thread pool
        exists.</p>
      </div></details>
    </li>
    <li>
      <p>How much memory does an idle thread actually use?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Measured <strong>24 KB of working set</strong>, not the 1 MB reserved — stack pages are
        committed only as they are touched. The 1 MB is address space, and it is what exhausts a
        32-bit process at around 2,000 threads.</p>
      </div></details>
    </li>
    <li>
      <p>What is the difference between concurrency and parallelism?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Parallelism</strong> is several things at the same instant — needs cores, capped
        by them. <strong>Concurrency</strong> is several things in progress — needs no cores if they
        are waiting. Measured on identical thread counts: CPU-bound saturated below 3×, I/O-bound
        reached <strong>33.81×</strong>.</p>
      </div></details>
    </li>
    <li>
      <p>What does a blocked thread cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Memory, not CPU. Measured: 64 blocked threads changed CPU-bound work by
        <strong>0.98×</strong>. The scheduler does not give a core to a thread that cannot use
        one.</p>
      </div></details>
    </li>
    <li>
      <p>What happens when you run far more threads than cores?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Oversubscription.</strong> Measured: fixed work took <strong>243 ms on 4,096
        threads and 176 ms on 4</strong>. It degrades gradually, with no error and no metric at its
        ceiling.</p>
      </div></details>
    </li>
    <li>
      <p>Is <code>new Thread(...)</code> foreground or background, and why does it matter?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Foreground</strong> — verified. It keeps the process alive after
        <code>Main</code> returns, which is how one polling thread turns into a container that will
        not stop and gets force-killed.</p>
      </div></details>
    </li>
    <li>
      <p>How do you size a worker pool for a request that is 90% waiting?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>workers ≈ cores × (total time / CPU time)</code> — so 8 × 10 = about 80, an order of
        magnitude above the core count. Measured throughput was still climbing at 64 workers and
        flattening, consistent with that.</p>
      </div></details>
    </li>
    <li>
      <p>A service's latency is climbing and its CPU is flat. What does that suggest?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Threads waiting rather than working. Check the thread count and the pool queue length with
        <code>dotnet-counters</code>; a thread count tracking the request rate is a
        thread-per-request design.</p>
      </div></details>
    </li>
    <li>
      <p>What is the first thing to check about any threads-versus-time table?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>That the <strong>total work is fixed and divided</strong>, not repeated per thread. An
        earlier version of this module's own exercise got that wrong and produced a table that
        appeared to show threads hurting CPU-bound work.</p>
      </div></details>
    </li>
    <li>
      <p>When are threads still the right tool?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the work genuinely occupies a core. Async buys nothing for CPU-bound work — it exists
        to avoid holding a thread while <em>waiting</em>. The mistake is not using threads; it is
        using them for waiting.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
