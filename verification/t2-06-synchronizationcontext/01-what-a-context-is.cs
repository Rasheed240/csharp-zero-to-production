// 01-what-a-context-is.cs — what a SynchronizationContext is, what capture means,
// and the observable difference between having one and not having one.
//
// A NOTE ON HOW THIS FILE WAS WRITTEN. The first version defined the context's
// Run(Action) helper to Post the work and then BLOCK on a ManualResetEventSlim
// until it finished. Every call inside it then used .GetAwaiter().GetResult().
// It deadlocked on the first await and had to be killed. That is exactly the
// deadlock this module is about, reproduced by accident while demonstrating it:
// the continuation was Posted back to the context thread, and the context thread
// was blocked waiting for the continuation.
// The fix used here is RunAsync(Func<Task>), which pumps the work as a real
// asynchronous operation and never blocks the pump thread. 03-deadlock.cs
// reproduces the broken version deliberately, with a timeout.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-what-a-context-is.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine("=== 1. a console app has NO context ===");
        Console.WriteLine();
        Console.WriteLine($"  SynchronizationContext.Current : " +
                          $"{SynchronizationContext.Current?.ToString() ?? "null"}");
        Console.WriteLine("  So does ASP.NET Core, and so does a worker service. The default in");
        Console.WriteLine("  modern .NET is no context at all. If you have never knowingly seen");
        Console.WriteLine("  one, that is why.");
        Console.WriteLine();
        Console.WriteLine("  With no context, a continuation resumes on a thread pool thread:");
        Report("no context", Where().GetAwaiter().GetResult());

        Console.WriteLine();
        Console.WriteLine("=== 2. with a single-threaded context, as a UI app has ===");
        Console.WriteLine();
        using (var ui = new SingleThreadContext("UI"))
        {
            ui.RunAsync(async () =>
            {
                Console.WriteLine($"  inside the context, Current is : {SynchronizationContext.Current}");
                Console.WriteLine($"  the context thread is          : {Environment.CurrentManagedThreadId}");
                Report("captured", await Where().ConfigureAwait(true));
            }).GetAwaiter().GetResult();

            Console.WriteLine($"  posts routed through the context : {ui.PostCount}");
        }
        Console.WriteLine();
        Console.WriteLine("  The continuation came back to the context's ONE thread, and it was");
        Console.WriteLine("  not a pool thread. That is the entire purpose: a UI framework needs");
        Console.WriteLine("  code after an await to run on the thread that owns the widgets.");
        Console.WriteLine();
        Console.WriteLine("  A SynchronizationContext is essentially one method:");
        Console.WriteLine("    Post(callback, state)  ->  'run this wherever I say work runs'");
        Console.WriteLine("  A UI framework implements it by putting the callback on the message");
        Console.WriteLine("  queue its single UI thread pumps.");

        Console.WriteLine();
        Console.WriteLine("=== 3. what 'capture' actually means ===");
        Console.WriteLine();
        Console.WriteLine("  At every await, the state machine reads the CURRENT context before");
        Console.WriteLine("  suspending and stores it. On resumption it Posts the continuation");
        Console.WriteLine("  back to that context instead of using the thread pool.");
        Console.WriteLine("  ConfigureAwait(false) says: do not read it, do not restore it.");
        Console.WriteLine();

        using (var ui = new SingleThreadContext("UI"))
        {
            ui.RunAsync(CompareBoth).GetAwaiter().GetResult();
            Console.WriteLine();
            Console.WriteLine($"  posts routed through the context : {ui.PostCount}");
            Console.WriteLine("  Of those three posts, only ONE is a continuation of the three");
            Console.WriteLine("  awaits above — the captured one. The other two are the harness:");
            Console.WriteLine("  starting the work on the context thread, and completing it.");
            Console.WriteLine("  The two ConfigureAwait(false) resumptions never touched the");
            Console.WriteLine("  context at all, which is what the thread numbers show.");
        }

        Console.WriteLine();
        Console.WriteLine("=== 4. TaskScheduler.Current is a second, separate thing ===");
        Console.WriteLine();
        Console.WriteLine($"  default TaskScheduler : {TaskScheduler.Current.GetType().Name}");
        Console.WriteLine("  An await captures the SynchronizationContext if there is one, and");
        Console.WriteLine("  falls back to TaskScheduler.Current only if there is not. Both being");
        Console.WriteLine("  default is what 'no context' really means, and it is why");
        Console.WriteLine("  ConfigureAwait(false) changes nothing observable in a console app or");
        Console.WriteLine("  in ASP.NET Core: there was never anything to capture.");
    }

    static void Report(string label, (int thread, bool pool) info) =>
        Console.WriteLine($"  {label,-26} resumed on thread {info.thread} (pool thread = {info.pool})");

    static async Task<(int, bool)> Where()
    {
        await Task.Delay(20).ConfigureAwait(true);   // captures, if there is a context
        return (Environment.CurrentManagedThreadId, Thread.CurrentThread.IsThreadPoolThread);
    }

    static async Task CompareBoth()
    {
        Console.WriteLine($"  started on thread            : {Environment.CurrentManagedThreadId}");

        await Task.Delay(20).ConfigureAwait(true);
        Console.WriteLine($"  after await (captured)       : {Environment.CurrentManagedThreadId}" +
                          $"  <- back on the context thread");

        await Task.Delay(20).ConfigureAwait(false);
        Console.WriteLine($"  after ConfigureAwait(false)  : {Environment.CurrentManagedThreadId}" +
                          $"  <- a pool thread, context abandoned");

        await Task.Delay(20).ConfigureAwait(true);
        Console.WriteLine($"  after a later plain await    : {Environment.CurrentManagedThreadId}" +
                          $"  <- STILL a pool thread");
        Console.WriteLine("  Note that last line: once you have left the context, a later plain");
        Console.WriteLine("  await cannot bring you back. There is nothing to capture any more.");
    }
}

/// <summary>
/// A single-threaded SynchronizationContext, which is the shape a UI framework
/// gives you: one thread, one queue, everything runs there.
/// </summary>
sealed class SingleThreadContext : SynchronizationContext, IDisposable
{
    private readonly BlockingCollection<(SendOrPostCallback, object?)> _queue = new();
    private readonly Thread _thread;
    private int _posts;

    public int PostCount => Volatile.Read(ref _posts);

    public SingleThreadContext(string name)
    {
        _thread = new Thread(Pump) { IsBackground = true, Name = name };
        _thread.Start();
    }

    private void Pump()
    {
        SetSynchronizationContext(this);
        foreach (var (callback, state) in _queue.GetConsumingEnumerable())
            callback(state);
    }

    public override void Post(SendOrPostCallback d, object? state)
    {
        Interlocked.Increment(ref _posts);
        _queue.Add((d, state));
    }

    public override void Send(SendOrPostCallback d, object? state)
    {
        var done = new ManualResetEventSlim(false);
        Post(_ => { try { d(state); } finally { done.Set(); } }, null);
        done.Wait();
        done.Dispose();
    }

    /// <summary>
    /// Runs asynchronous work ON the context thread and returns a Task that
    /// completes when it finishes. Crucially this never BLOCKS the context
    /// thread, so continuations Posted back to it can actually run.
    /// </summary>
    public Task RunAsync(Func<Task> work)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Post(async void (_) =>
        {
            try
            {
                await work().ConfigureAwait(true);
                tcs.TrySetResult();
            }
            catch (Exception ex)
            {
                tcs.TrySetException(ex);
            }
        }, null);
        return tcs.Task;
    }

    public void Dispose()
    {
        _queue.CompleteAdding();
        _thread.Join(2000);
        _queue.Dispose();
    }
}
