// 03-static-ctor-threading.cs — the runtime guarantees a static constructor
// runs exactly once, and makes every other thread wait. That guarantee is
// genuinely useful and is also how you deadlock a process at startup.
// .NET 10.0.400. Run: dotnet run 03-static-ctor-threading.cs -c Release

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

// ---- 1. exactly once, under contention -----------------------------------
class ExpensiveSingleton
{
    public static int TimesInitialised;
    public static readonly ExpensiveSingleton Instance = Build();

    private static ExpensiveSingleton Build()
    {
        Interlocked.Increment(ref TimesInitialised);
        Thread.Sleep(150);                    // pretend this is expensive
        return new ExpensiveSingleton();
    }

    public string Describe() => "the one instance";
}

// ---- 2. other threads BLOCK until it finishes ----------------------------
class SlowInit
{
    public static readonly DateTime ReadyAt = Initialise();
    static SlowInit() { }

    private static DateTime Initialise()
    {
        Thread.Sleep(300);
        return DateTime.UtcNow;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. sixteen threads racing to touch a static ---");
        var barrier = new Barrier(16);
        var tasks = new Task[16];
        for (int i = 0; i < 16; i++)
        {
            tasks[i] = Task.Run(() =>
            {
                barrier.SignalAndWait();
                _ = ExpensiveSingleton.Instance.Describe();
            });
        }
        Task.WaitAll(tasks);
        Console.WriteLine($"  initialiser ran {ExpensiveSingleton.TimesInitialised} time(s) " +
                          $"across 16 concurrent threads");
        Console.WriteLine("  No lock was written. The runtime supplied one.");

        Console.WriteLine();
        Console.WriteLine("--- 2. what the other threads were doing: waiting ---");
        var sw = Stopwatch.StartNew();
        var waiters = new Task<double>[4];
        for (int i = 0; i < 4; i++)
        {
            waiters[i] = Task.Run(() =>
            {
                var local = Stopwatch.StartNew();
                _ = SlowInit.ReadyAt;
                return local.Elapsed.TotalMilliseconds;
            });
        }
        Task.WaitAll(waiters);
        sw.Stop();
        Console.WriteLine($"  initialiser sleeps 300 ms");
        for (int i = 0; i < waiters.Length; i++)
            Console.WriteLine($"    thread {i} blocked for {waiters[i].Result,6:F0} ms");
        Console.WriteLine($"  total wall clock: {sw.Elapsed.TotalMilliseconds:F0} ms");
        Console.WriteLine("  Every thread that touched the type waited for the one that won.");

        Console.WriteLine();
        Console.WriteLine("--- 3. what a CYCLE actually does ---");
        Console.WriteLine("  Two types whose static initialisers each read the other.");
        Console.WriteLine("  Folklore says this deadlocks. Here is what was measured:");
        Console.WriteLine($"    touching Cyclic1 first -> Cyclic1.Value={Cyclic1.Value}, " +
                          $"Cyclic2.Value={Cyclic2.Value}");
        Console.WriteLine("  No hang, no exception. The runtime broke the cycle by handing");
        Console.WriteLine("  back the DEFAULT value of the field whose initialiser had not");
        Console.WriteLine("  finished — so one of these numbers is built on a zero that was");
        Console.WriteLine("  never assigned. Which one depends on which type is touched first.");
    }
}

class Cyclic1
{
    public static readonly int Value;
    static Cyclic1()
    {
        int seen = Cyclic2.Value;
        Console.WriteLine($"    Cyclic1 initialiser read Cyclic2.Value = {seen}");
        Value = seen + 1;
    }
}

class Cyclic2
{
    public static readonly int Value;
    static Cyclic2()
    {
        int seen = Cyclic1.Value;
        Console.WriteLine($"    Cyclic2 initialiser read Cyclic1.Value = {seen}");
        Value = seen + 1;
    }
}
