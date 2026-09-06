// 04-minimal-example.cs — the smallest program that loses updates, and the two
// one-word changes that do and do not fix it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Threading;

class Program
{
    static int _plain;
    static volatile int _volatile;
    static int _atomic;

    static void Main()
    {
        Run("plain int  ++", () => _plain++, () => _plain);
        Run("volatile int ++", () => _volatile++, () => _volatile);
        Run("Interlocked.Increment", () => Interlocked.Increment(ref _atomic), () => _atomic);
    }

    static void Run(string label, Action increment, Func<int> read)
    {
        var threads = new Thread[4];
        for (var t = 0; t < 4; t++)
        {
            threads[t] = new Thread(() => { for (var i = 0; i < 250_000; i++) increment(); });
            threads[t].Start();
        }
        foreach (var t in threads) t.Join();

        var actual = read();
        Console.WriteLine($"{label,-24} expected 1,000,000, got {actual,9:N0}" +
                          $"   {(actual == 1_000_000 ? "correct" : "LOST " + (1_000_000 - actual))}");
    }
}
