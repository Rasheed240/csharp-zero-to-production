// 04-minimal-example.cs — the smallest program showing what Interlocked fixes
// and what it does not.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Threading;

class Program
{
    static int _plain;
    static int _atomic;
    static long _count, _total;

    static void Main()
    {
        // What Interlocked fixes: one location, one operation.
        Run(() => { _plain++; Interlocked.Increment(ref _atomic); });
        Console.WriteLine($"plain  ++ : {_plain,7:N0} of 800,000   {(_plain == 800_000 ? "correct" : "WRONG")}");
        Console.WriteLine($"atomic ++ : {_atomic,7:N0} of 800,000   {(_atomic == 800_000 ? "correct" : "WRONG")}");

        // What it does not fix: two locations that must agree.
        var torn = false;
        var stop = new CancellationTokenSource();
        var writer = new Thread(() =>
        {
            while (!stop.IsCancellationRequested)
            {
                Interlocked.Increment(ref _count);          // atomic
                Interlocked.Add(ref _total, 1_000);         // atomic
            }
        }) { IsBackground = true };
        var reader = new Thread(() =>
        {
            while (!stop.IsCancellationRequested)
            {
                var c = Volatile.Read(ref _count);
                var t = Volatile.Read(ref _total);
                if (c > 0 && t / c != 1_000) { torn = true; return; }   // impossible mean
            }
        }) { IsBackground = true };

        writer.Start(); reader.Start();
        Thread.Sleep(50);
        stop.Cancel();
        writer.Join(500); reader.Join(500);

        Console.WriteLine($"both atomic, reader saw an impossible mean : {torn}");
        Console.WriteLine("Atomic is not transactional: two atomic writes are still two writes.");
    }

    static void Run(Action body)
    {
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        for (var t = 0; t < 8; t++)
        {
            threads[t] = new Thread(() => { ready.Wait(); for (var i = 0; i < 100_000; i++) body(); });
            threads[t].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
    }
}
