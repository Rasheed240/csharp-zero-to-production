// 02-cost.cs — what an await actually costs, measured on both paths: the one
// where it completes synchronously and never suspends, and the one where it does.
// The gap between them is the whole design.
//
// A NOTE ON THE RETURN VALUE. An earlier version of this file returned 1 from
// every method and every row read 0 bytes, which contradicted the point it was
// making. AsyncTaskMethodBuilder<int> keeps cached Task objects for small
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
        Row("plain sync method", () => _sink += PlainSync());
        Row("async Task<int>, no await at all", () => _sink += NoAwait().GetAwaiter().GetResult());
        Row("async Task<int>, await completed", () => _sink += AwaitCompleted().GetAwaiter().GetResult());
        Row("async ValueTask<int>, await done", () => _sink += VtAwaitCompleted().GetAwaiter().GetResult());
        Row("Task.FromResult, not async", () => _sink += FromResult().GetAwaiter().GetResult());
        Row("ValueTask, not async", () => _sink += VtNoAsync().GetAwaiter().GetResult());

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
        Row("async Task<int> returning 4242", () => _sink += NoAwait().GetAwaiter().GetResult());
        Row("async Task<int> returning 1", () => _sink += NoAwaitSmall().GetAwaiter().GetResult());
        Row("async Task<bool> returning true", () => _sink += NoAwaitBool().GetAwaiter().GetResult() ? 1 : 0);
        Console.WriteLine();
        Console.WriteLine("  The runtime keeps pre-made Task objects for small ints and for both");
        Console.WriteLine("  bools, so an async method returning one of those can allocate nothing");
        Console.WriteLine("  at all. Worth knowing for two reasons: it is a real optimisation you");
        Console.WriteLine("  get for free on Task<bool>, and it is a trap when benchmarking — a");
        Console.WriteLine("  microbenchmark that returns 1 will tell you async is free.");

        Console.WriteLine();
        Console.WriteLine("=== 2. an await that DOES suspend ===");
        Console.WriteLine();
        Console.WriteLine("  Same shape, but the awaited thing has not finished, so the state");
        Console.WriteLine("  machine must be boxed onto the heap and a continuation registered.");
        Console.WriteLine();
        Console.WriteLine("  method                            bytes/call   ns/call");
        Row("async Task<int>, suspends", () => _sink += Suspends().GetAwaiter().GetResult(), reps: 20_000);
        Row("async ValueTask<int>, suspends", () => _sink += VtSuspends().GetAwaiter().GetResult(), reps: 20_000);

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
        Console.WriteLine($"  5 awaits, 0 of which had to wait -> suspended {_resumptions} time(s)");

        _resumptions = 0;
        CountingAwaits(suspendCount: 3).GetAwaiter().GetResult();
        Console.WriteLine($"  5 awaits, 3 of which had to wait -> suspended {_resumptions} time(s)");

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
            var bytes = Alloc(() => _sink += Nest(d).GetAwaiter().GetResult(), 100_000);
            var ns = Nanos(() => _sink += Nest(d).GetAwaiter().GetResult(), 100_000);
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
    static int PlainSync() => 4242;
    static async Task<int> NoAwait() { return 4242; }
    static async Task<int> NoAwaitSmall() { return 1; }
    static async Task<bool> NoAwaitBool() { return true; }
    static async Task<int> AwaitCompleted() { await Task.CompletedTask; return 4242; }
    static async ValueTask<int> VtAwaitCompleted() { await Task.CompletedTask; return 4242; }
    static Task<int> FromResult() => Task.FromResult(4242);
    static ValueTask<int> VtNoAsync() => new(4242);

    // --- the suspending path --------------------------------------------------
    static async Task<int> Suspends() { await Task.Yield(); return 4242; }
    static async ValueTask<int> VtSuspends() { await Task.Yield(); return 4242; }

    // --- counting suspensions -------------------------------------------------
    static async Task CountingAwaits(int suspendCount)
    {
        for (var i = 0; i < 5; i++)
            await new Counted(suspend: i < suspendCount);
    }

    // --- nesting --------------------------------------------------------------
    static async Task<int> Nest(int depth)
    {
        if (depth <= 1) return 4242;
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
        for (var i = 0; i < 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < reps; i++) a();
        return (GC.GetAllocatedBytesForCurrentThread() - before) / reps;
    }

    static double Nanos(Action a, int reps)
    {
        for (var i = 0; i < 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < reps; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / reps;
    }

    /// <summary>An awaitable that records when it forces a suspension.</summary>
    readonly struct Counted
    {
        private readonly bool _suspend;
        public Counted(bool suspend) => _suspend = suspend;
        public CountedAwaiter GetAwaiter() => new(_suspend);
    }

    readonly struct CountedAwaiter : INotifyCompletion
    {
        private readonly bool _suspend;
        public CountedAwaiter(bool suspend) => _suspend = suspend;

        // IsCompleted returning false is the ONLY thing that causes a suspension.
        public bool IsCompleted => !_suspend;
        public void GetResult() { }
        public void OnCompleted(Action continuation)
        {
            Interlocked.Increment(ref _resumptions);
            ThreadPool.QueueUserWorkItem(_ => continuation());
        }
    }
}
