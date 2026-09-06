// 05-minimal-example.cs — the smallest program that shows a context being
// captured, and ConfigureAwait(false) declining to capture it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine($"no context here      : {SynchronizationContext.Current?.ToString() ?? "null"}");

        var ui = new OneThreadContext();
        ui.Run(async () =>
        {
            Console.WriteLine($"on the context thread: {Environment.CurrentManagedThreadId}");

            await Task.Delay(10);                          // captures the context
            Console.WriteLine($"after plain await    : {Environment.CurrentManagedThreadId}");

            await Task.Delay(10).ConfigureAwait(false);    // declines to capture
            Console.WriteLine($"after CA(false)      : {Environment.CurrentManagedThreadId}");
        });
    }
}

sealed class OneThreadContext : SynchronizationContext
{
    private readonly BlockingCollection<(SendOrPostCallback, object?)> _queue = new();

    public OneThreadContext() =>
        new Thread(Pump) { IsBackground = true }.Start();

    private void Pump()
    {
        SetSynchronizationContext(this);
        foreach (var (callback, state) in _queue.GetConsumingEnumerable())
            callback(state);
    }

    public override void Post(SendOrPostCallback d, object? state) => _queue.Add((d, state));

    /// <summary>Starts the work on the context thread and waits WITHOUT blocking it.</summary>
    public void Run(Func<Task> work)
    {
        var finished = new TaskCompletionSource();
        Post(async void (_) =>
        {
            try { await work(); finished.TrySetResult(); }
            catch (Exception ex) { finished.TrySetException(ex); }
        }, null);
        finished.Task.Wait(2000);
        _queue.CompleteAdding();
    }
}
