// 02-the-deadlock.cs — the classic sync-over-async deadlock, reproduced
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

        Run("UI context, .Result, plain await", (ctx, done) => ctx.Post(_ =>
        {
            var _unused = CapturingAsync(done).Result;
        }, null));

        Run("UI context, .Wait(), plain await", (ctx, done) => ctx.Post(_ =>
        {
            CapturingAsync(done).Wait();
        }, null));

        Run("UI context, GetAwaiter().GetResult()", (ctx, done) => ctx.Post(_ =>
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

        Run("FIX 1: ConfigureAwait(false) in the library", (ctx, done) => ctx.Post(_ =>
        {
            var _unused = NonCapturingAsync(done).Result;
        }, null));

        Run("FIX 2: await instead of blocking", (ctx, done) => ctx.Post(async void (_) =>
        {
            var _unused = await CapturingAsync(done).ConfigureAwait(true);
        }, null));

        Run("FIX 3: no context to capture", (_, done) =>
        {
            ThreadPool.QueueUserWorkItem(_ =>
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

    static void Run(string label, Action<SingleThreadContext, ManualResetEventSlim> start,
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
                ctx.Post(_ => { }, null);          // prove the pump is alive
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

    /// <summary>Captures the context at its await. The dangerous shape for a library.</summary>
    static async Task<int> CapturingAsync(ManualResetEventSlim done)
    {
        await Task.Delay(50);                      // no ConfigureAwait: captures
        done.Set();
        return 1;
    }

    /// <summary>Does not capture. The shape a library should ship.</summary>
    static async Task<int> NonCapturingAsync(ManualResetEventSlim done)
    {
        await Task.Delay(50).ConfigureAwait(false);
        done.Set();
        return 1;
    }
}

/// <summary>A single-threaded SynchronizationContext, as a UI framework provides.</summary>
sealed class SingleThreadContext : SynchronizationContext
{
    private readonly BlockingCollection<(SendOrPostCallback, object?)> _queue = new();
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

    /// <summary>Walk away from the thread; it is background, so it dies with the process.</summary>
    public void Abandon() => _queue.CompleteAdding();
}
