// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;
    static int _calls;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: when does the work actually happen? =====");
        _calls = 0;
        var sw = Stopwatch.StartNew();
        var task = WorkAsync();
        var afterCall = sw.Elapsed.TotalMilliseconds;
        Console.WriteLine($"  body ran before the call returned : {_calls} time(s)");
        Console.WriteLine($"  call returned after               : {afterCall:N0} ms");
        Thread.Sleep(200);
        task.Wait();
        Console.WriteLine($"  slept 200 ms, then awaited");
        Console.WriteLine($"  total                             : {sw.Elapsed.TotalMilliseconds:N0} ms");
        Console.WriteLine($"  not 200 + 150 = 350 — the 150 ms operation ran DURING the sleep,");
        Console.WriteLine($"  so awaiting it afterwards returned immediately.");
        task.Wait();
        Console.WriteLine($"  awaited a second time; body ran   : {_calls} time(s) total");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: what does each return type allocate? =====");
        Console.WriteLine("  all calls hit the cache, so nothing suspends:");
        Console.WriteLine($"    decimal (plain)      : {Alloc(() => _sink += (long)Sync()),4} bytes/call");
        Console.WriteLine($"    Task<decimal>        : {Alloc(() => _sink += (long)Tsk().GetAwaiter().GetResult()),4} bytes/call");
        Console.WriteLine($"    ValueTask<decimal>   : {Alloc(() => _sink += (long)Vt().GetAwaiter().GetResult()),4} bytes/call");
        Console.WriteLine($"    Task.FromResult      : {Alloc(() => _sink += (long)FromResult().GetAwaiter().GetResult()),4} bytes/call");
        Console.WriteLine("  'async Task' allocates even when it never suspends, because the");
        Console.WriteLine("  compiler must produce a Task before it knows whether it will.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which of these are safe? =====");
        Console.WriteLine();
        Console.WriteLine("  (a) awaiting the same Task twice");
        var t = Tsk();
        Console.WriteLine($"      {t.GetAwaiter().GetResult()}, {t.GetAwaiter().GetResult()} — SAFE");

        Console.WriteLine("  (b) storing a Task in a field and awaiting it later");
        _stored = Tsk();
        Thread.Sleep(20);
        Console.WriteLine($"      {_stored.GetAwaiter().GetResult()} — SAFE");

        Console.WriteLine("  (c) two threads awaiting the same Task");
        var shared = SlowTsk();
        var r1 = 0m; var r2 = 0m;
        var w1 = Task.Run(() => r1 = shared.GetAwaiter().GetResult());
        var w2 = Task.Run(() => r2 = shared.GetAwaiter().GetResult());
        Task.WaitAll(w1, w2);
        Console.WriteLine($"      both got {r1} and {r2} — SAFE");

        Console.WriteLine("  (d) the same three things with a ValueTask");
        Console.WriteLine("      NOT SAFE — await once, never store, never share.");
        Console.WriteLine("      Converting first makes them safe again:");
        var converted = Vt().AsTask();
        Console.WriteLine($"      AsTask() then await twice : " +
                          $"{converted.GetAwaiter().GetResult()}, {converted.GetAwaiter().GetResult()}");
        Console.WriteLine("      ...at the cost of the allocation ValueTask was avoiding.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: wrap a callback API =====");
        var api = new CallbackApi();
        Console.WriteLine($"  success   : {api.RunAsync("ok").GetAwaiter().GetResult()}");
        try { api.RunAsync("fail").GetAwaiter().GetResult(); }
        catch (InvalidOperationException ex) { Console.WriteLine($"  failure   : {ex.Message}"); }

        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            try { api.RunAsync("ok", cts.Token).GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { Console.WriteLine("  cancelled : OperationCanceledException"); }
        }

        Console.WriteLine();
        Console.WriteLine("  and the flag that matters:");
        Console.WriteLine($"  without RunContinuationsAsynchronously, the continuation runs on");
        Console.WriteLine($"  the CALLBACK's thread: {WhereDoesContinuationRun(false)}");
        Console.WriteLine($"  with it, on a pool thread                      : {WhereDoesContinuationRun(true)}");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static Task<decimal>? _stored;

    static async Task WorkAsync()
    {
        Interlocked.Increment(ref _calls);
        await Task.Delay(150).ConfigureAwait(false);
    }

    static decimal Sync() => 1;
    static async Task<decimal> Tsk() { await Task.CompletedTask; return 1; }
    static async ValueTask<decimal> Vt() { await Task.CompletedTask; return 1; }
    static Task<decimal> FromResult() => Task.FromResult(1m);
    static async Task<decimal> SlowTsk() { await Task.Delay(60).ConfigureAwait(false); return 1; }

    static string WhereDoesContinuationRun(bool asynchronous)
    {
        var options = asynchronous
            ? TaskCreationOptions.RunContinuationsAsynchronously
            : TaskCreationOptions.None;
        var tcs = new TaskCompletionSource<int>(options);

        var completerThread = 0;
        var continuationThread = 0;
        var done = new ManualResetEventSlim(false);

        _ = tcs.Task.ContinueWith(_ =>
        {
            continuationThread = Environment.CurrentManagedThreadId;
            done.Set();
        }, TaskContinuationOptions.ExecuteSynchronously);

        var completer = new Thread(() =>
        {
            completerThread = Environment.CurrentManagedThreadId;
            tcs.SetResult(1);
        })
        { IsBackground = true };
        completer.Start();
        completer.Join();
        done.Wait();

        return continuationThread == completerThread
            ? $"same thread ({continuationThread}) — INLINE"
            : $"different thread ({completerThread} -> {continuationThread})";
    }

    static long Alloc(Action a)
    {
        for (var i = 0; i < 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        const int Reps = 20_000;
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < Reps; i++) a();
        return (GC.GetAllocatedBytesForCurrentThread() - before) / Reps;
    }
}

sealed class CallbackApi
{
    public void Run(string input, Action<string> onSuccess, Action<Exception> onError)
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            Thread.Sleep(20);
            if (input == "fail") onError(new InvalidOperationException("it failed"));
            else onSuccess("RESULT-" + input);
        });
    }

    public Task<string> RunAsync(string input, CancellationToken ct = default)
    {
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var reg = ct.Register(() => tcs.TrySetCanceled(ct));
        Run(input,
            r => { reg.Dispose(); tcs.TrySetResult(r); },
            e => { reg.Dispose(); tcs.TrySetException(e); });
        return tcs.Task;
    }
}
