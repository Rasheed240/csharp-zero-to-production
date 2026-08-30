// 01-what-a-thread-is.cs — what a thread actually is, read from the running
// process rather than described. Every number here is this machine's.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-what-a-thread-is.cs
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- the machine ---");
        Console.WriteLine($"  Environment.ProcessorCount : {Environment.ProcessorCount}");
        Console.WriteLine($"  OS                         : {RuntimeInformation.OSDescription}");
        Console.WriteLine($"  runtime                    : {RuntimeInformation.FrameworkDescription}");
        Console.WriteLine("  ProcessorCount is the number of threads that can be RUNNING at");
        Console.WriteLine("  the same instant. Every thread beyond that is waiting for a turn.");

        Console.WriteLine();
        Console.WriteLine("--- the process already has threads you did not create ---");
        var process = Process.GetCurrentProcess();
        Console.WriteLine($"  OS threads in this process : {process.Threads.Count}");
        Console.WriteLine($"  managed threads you wrote  : 1 (this one)");
        Console.WriteLine("  The rest belong to the runtime: the GC, the finaliser, the");
        Console.WriteLine("  tiered-compilation background JIT, and the debugger if attached.");

        Console.WriteLine();
        Console.WriteLine("--- a thread has an identity and its own stack ---");
        Console.WriteLine($"  current ManagedThreadId : {Environment.CurrentManagedThreadId}");
        Console.WriteLine($"  IsThreadPoolThread      : {Thread.CurrentThread.IsThreadPoolThread}");
        Console.WriteLine($"  IsBackground            : {Thread.CurrentThread.IsBackground}");
        Console.WriteLine($"  Name                    : {Thread.CurrentThread.Name ?? "(null)"}");

        var worker = new Thread(() =>
        {
            Console.WriteLine($"  inside the new thread   : id={Environment.CurrentManagedThreadId}, " +
                              $"pool={Thread.CurrentThread.IsThreadPoolThread}, " +
                              $"background={Thread.CurrentThread.IsBackground}");
        })
        { Name = "ledger-worker" };
        worker.Start();
        worker.Join();
        Console.WriteLine("  A different id. Separate stack, separate register state.");

        Console.WriteLine();
        Console.WriteLine("--- each thread's locals are private; the heap is shared ---");
        var shared = new int[1];
        var t1 = new Thread(() => { var local = 1; shared[0] += local; });
        var t2 = new Thread(() => { var local = 2; shared[0] += local; });
        t1.Start(); t2.Start(); t1.Join(); t2.Join();
        Console.WriteLine($"  two threads, each with its own 'local'  : no interference");
        Console.WriteLine($"  both wrote to the same heap array      : shared[0] = {shared[0]}");
        Console.WriteLine("  That difference is the entire subject of the next few modules.");

        Console.WriteLine();
        Console.WriteLine("--- stack size is reserved per thread, and it is not small ---");
        var deep = 0;
        var stackProbe = new Thread(() =>
        {
            try { Recurse(ref deep); }
            catch (InsufficientExecutionStackException) { }
        }, maxStackSize: 256 * 1024);
        stackProbe.Start();
        stackProbe.Join();
        Console.WriteLine($"  frames before a 256 KB stack ran low : {deep:N0}");

        var deepDefault = 0;
        var defaultProbe = new Thread(() =>
        {
            try { Recurse(ref deepDefault); }
            catch (InsufficientExecutionStackException) { }
        });
        defaultProbe.Start();
        defaultProbe.Join();
        Console.WriteLine($"  frames before the DEFAULT stack ran low : {deepDefault:N0}");
        Console.WriteLine($"  ratio                                   : {(double)deepDefault / deep:0.0}x");
        Console.WriteLine("  Note the ratio is NOT the 4x the stack sizes would suggest.");
        Console.WriteLine("  EnsureSufficientExecutionStack demands a fixed headroom before");
        Console.WriteLine("  it will say yes, and that margin is a large fraction of 256 KB");
        Console.WriteLine("  and a small one of 1 MB. The numbers show the stacks differ;");
        Console.WriteLine("  they do not measure the sizes.");
        Console.WriteLine("  The default reserve on Windows is 1 MB of ADDRESS SPACE per");
        Console.WriteLine("  thread. Pages are committed as the stack grows, so an idle");
        Console.WriteLine("  thread costs far less physical memory than 1 MB — but the");
        Console.WriteLine("  reservation is why a 32-bit process dies at ~2,000 threads.");

        Console.WriteLine();
        Console.WriteLine("--- foreground threads keep the process alive; background ones do not ---");
        var background = new Thread(() => Thread.Sleep(5_000)) { IsBackground = true };
        background.Start();
        Console.WriteLine($"  started a background thread that sleeps 5s");
        Console.WriteLine($"  IsAlive : {background.IsAlive}");
        Console.WriteLine("  This program is about to exit without waiting for it. A");
        Console.WriteLine("  FOREGROUND thread would have held the process open for 5");
        Console.WriteLine("  seconds — which is why a stray non-background thread shows up");
        Console.WriteLine("  as 'the service takes 30 seconds to shut down'.");
        Console.WriteLine("  Thread-pool threads are always background.");
    }

    // EnsureSufficientExecutionStack throws before the stack actually overflows,
    // so this measures usable depth without killing the process. A real
    // StackOverflowException cannot be caught and terminates immediately.
    static void Recurse(ref int depth)
    {
        RuntimeHelpers.EnsureSufficientExecutionStack();
        depth++;
        Recurse(ref depth);
    }
}

file static class RuntimeHelpers
{
    public static void EnsureSufficientExecutionStack()
        => System.Runtime.CompilerServices.RuntimeHelpers.EnsureSufficientExecutionStack();
}
