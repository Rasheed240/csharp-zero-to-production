// 04-minimal-example.cs — the smallest program showing what a concurrent
// collection guarantees and what it does not.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Threading;

class Program
{
    static void Main()
    {
        // What it guarantees: each method is atomic. TryAdd wins exactly once.
        var atomic = new ConcurrentDictionary<string, int>();
        var atomicWins = 0;
        Run(() => { if (atomic.TryAdd("k", 1)) Interlocked.Increment(ref atomicWins); });
        Console.WriteLine($"TryAdd            : {atomicWins} thread(s) added   {(atomicWins == 1 ? "correct" : "WRONG")}");

        // What it does not: two atomic calls are not one atomic operation.
        var composed = new ConcurrentDictionary<string, int>();
        var composedWins = 0;
        Run(() =>
        {
            if (!composed.ContainsKey("k"))              // CHECK
            {
                composed["k"] = 1;                       // ACT
                Interlocked.Increment(ref composedWins);
            }
        });
        Console.WriteLine($"ContainsKey + set : {composedWins} thread(s) added   {(composedWins == 1 ? "correct this run" : "WRONG")}");
        Console.WriteLine();
        Console.WriteLine("Thread-safe means each METHOD is atomic. Your sequence of methods is");
        Console.WriteLine("a new operation, with a new gap, that nothing protects for you.");
    }

    static void Run(Action body)
    {
        var ready = new ManualResetEventSlim(false);
        var threads = new Thread[16];
        for (var i = 0; i < 16; i++)
        {
            threads[i] = new Thread(() => { ready.Wait(); body(); });
            threads[i].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
    }
}
