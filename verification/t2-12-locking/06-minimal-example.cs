// 06-minimal-example.cs — the smallest program showing what a lock buys and what
// it costs: the same counter with and without one.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 06-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;

class Program
{
    static readonly Lock Gate = new();      // System.Threading.Lock, .NET 9+
    static int _unlocked;
    static int _locked;

    static void Main()
    {
        var t1 = Run(() => _unlocked++);
        var t2 = Run(() => { lock (Gate) { _locked++; } });

        Console.WriteLine($"no lock : {_unlocked,9:N0} of 800,000   {(_unlocked == 800_000 ? "correct" : "WRONG")}");
        Console.WriteLine($"lock    : {_locked,9:N0} of 800,000   {(_locked == 800_000 ? "correct" : "WRONG")}");
        Console.WriteLine($"the lock cost {t2 / t1:N1}x the time, and is the difference between");
        Console.WriteLine("an answer and a number.");
    }

    static double Run(Action increment)
    {
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        for (var t = 0; t < 8; t++)
        {
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                for (var i = 0; i < 100_000; i++) increment();
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var t in threads) t.Join();
        return sw.Elapsed.TotalMilliseconds;
    }
}
