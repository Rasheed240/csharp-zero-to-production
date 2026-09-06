// 01-what-a-task-is.cs — a Task is a promise object with a state machine of its
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
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        Console.WriteLine($"  before                : {tcs.Task.Status}");
        var waiter = Task.Run(async () =>
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

    static async Task SlowAsync() => await Task.Delay(200).ConfigureAwait(false);

    static async Task CountedAsync()
    {
        Interlocked.Increment(ref _calls);
        await Task.Delay(20).ConfigureAwait(false);
    }
}
