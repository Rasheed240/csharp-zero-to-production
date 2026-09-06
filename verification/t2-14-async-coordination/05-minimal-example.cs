// 05-minimal-example.cs — the smallest program showing a concurrency limit that
// works, and a producer/consumer channel that shuts down cleanly.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

class Program
{
    static int _inFlight, _peak;

    static async Task Main()
    {
        // 1. A limit that actually limits.
        using var gate = new SemaphoreSlim(3, 3);          // note the maximum
        await Task.WhenAll(Enumerable.Range(0, 50).Select(async _ =>
        {
            await gate.WaitAsync();
            try { await WorkAsync(); }
            finally { gate.Release(); }                    // the finally is not optional
        }));
        Console.WriteLine($"50 operations, limit 3, peak concurrent = {_peak}");

        // 2. A producer and a consumer that both finish.
        var channel = Channel.CreateBounded<int>(8);       // bounded: back pressure
        var consumer = Task.Run(async () =>
        {
            var n = 0;
            await foreach (var _ in channel.Reader.ReadAllAsync()) n++;
            return n;
        });

        try
        {
            for (var i = 0; i < 100; i++) await channel.Writer.WriteAsync(i);
        }
        finally
        {
            channel.Writer.Complete();                     // or the consumer waits forever
        }

        Console.WriteLine($"consumer read {await consumer} items, then the loop ended");
    }

    static async Task WorkAsync()
    {
        var now = Interlocked.Increment(ref _inFlight);
        var peak = Volatile.Read(ref _peak);
        while (now > peak && Interlocked.CompareExchange(ref _peak, now, peak) != peak)
            peak = Volatile.Read(ref _peak);
        try { await Task.Delay(20); }
        finally { Interlocked.Decrement(ref _inFlight); }
    }
}
