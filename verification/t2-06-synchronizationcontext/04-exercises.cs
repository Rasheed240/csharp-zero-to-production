// 04-exercises.cs — every answer claimed in this module's exercises, run.
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
        WithContext(async ctxThread =>
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
        Deadlock("(a) UI context, .Result on a capturing method", ct => Capturing());
        Deadlock("(b) UI context, .Result, ConfigureAwait(false)", ct => NonCapturing());
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
        Console.WriteLine("  ConfigureAwait(false) opts out of the FORMER only. AsyncLocal<T> —");
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
        Console.WriteLine($"  plain await                 {Alloc(() => _sink += Plain().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() => _sink += Plain().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine($"  ConfigureAwait(true)        {Alloc(() => _sink += True().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() => _sink += True().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine($"  ConfigureAwait(false)       {Alloc(() => _sink += False().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() => _sink += False().GetAwaiter().GetResult()),7:N0}");
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
        await Task.Delay(30).ConfigureAwait(false);   // suspends -> leaves the context
        await Task.Delay(30);                         // plain, but context already gone
    }

    static async Task FirstCompletesSync()
    {
        await Task.CompletedTask.ConfigureAwait(false);  // does NOT suspend -> still on context
        await Task.Delay(30);                            // plain -> captures -> deadlock
    }

    // --- Exercise 3 -----------------------------------------------------------
    static async Task Capturing() => await Task.Delay(30);
    static async Task NonCapturing() => await Task.Delay(30).ConfigureAwait(false);

    // --- Exercise 4 -----------------------------------------------------------
    static readonly AsyncLocal<string> Scope = new();

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
    static async Task<int> Plain() { await Task.CompletedTask; return 1; }
    static async Task<int> True() { await Task.CompletedTask.ConfigureAwait(true); return 1; }
    static async Task<int> False() { await Task.CompletedTask.ConfigureAwait(false); return 1; }

    // --- harness --------------------------------------------------------------
    static void WithContext(Func<int, Task> work)
    {
        using var ctx = new SingleThreadContext();
        ctx.RunAsync(work).Wait(TimeoutMs);
    }

    static void Deadlock(string label, Func<CancellationToken, Task> work)
    {
        var done = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        var ctx = new SingleThreadContext();
        try
        {
            ctx.Post(_ =>
            {
                work(CancellationToken.None).GetAwaiter().GetResult();
                done.Set();
            }, null);
            Report(label, done.Wait(TimeoutMs), sw);
        }
        finally { ctx.Abandon(); }
    }

    static void Deadlock(string label, Func<Task> work) => Deadlock(label, _ => work());

    static void DeadlockOnPool(string label, Func<Task> work)
    {
        var done = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        ThreadPool.QueueUserWorkItem(_ =>
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
        for (var i = 0; i < 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < reps; i++) a();
        return (GC.GetAllocatedBytesForCurrentThread() - before) / reps;
    }

    static double Nanos(Action a, int reps = 100_000)
    {
        for (var i = 0; i < 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < reps; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / reps;
    }
}

/// <summary>A single-threaded SynchronizationContext, as WPF and WinForms provide.</summary>
sealed class SingleThreadContext : SynchronizationContext, IDisposable
{
    private readonly BlockingCollection<(SendOrPostCallback, object?)> _queue = new();
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

    public override void Post(SendOrPostCallback d, object? state) => _queue.Add((d, state));

    /// <summary>Runs async work ON the context thread without ever blocking it.</summary>
    public Task RunAsync(Func<int, Task> work)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Post(async void (_) =>
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

    public void Abandon() => _queue.CompleteAdding();
    public void Dispose() => Abandon();
}
