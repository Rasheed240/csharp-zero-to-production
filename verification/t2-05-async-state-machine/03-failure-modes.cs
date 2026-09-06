// 03-failure-modes.cs — the four ways the state machine bites, and what each one
// looks like from the outside. Every one of these is something you will read in a
// log or a dump rather than in a debugger, so the point of this file is to make
// the symptoms recognisable.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-failure-modes.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine("=== 1. two different stacks, and only one of them is real ===");
        Console.WriteLine();
        try
        {
            OuterAsync().GetAwaiter().GetResult();
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine("  stack trace as thrown from three async frames down:");
            foreach (var line in ex.StackTrace!.Split('\n').Take(8))
                Console.WriteLine("    " + line.Trim());
        }
        Console.WriteLine();
        Console.WriteLine("  That is clean: Inner, Middle, Outer, Main, with line numbers, exactly");
        Console.WriteLine("  as if none of it were async. Since .NET Core 2.1 the runtime rewrites");
        Console.WriteLine("  async frames back into the method names you wrote, so the MoveNext and");
        Console.WriteLine("  ThrowForNonSuccess noise you will see in older articles is gone.");
        Console.WriteLine();
        Console.WriteLine("  But that trace is RECONSTRUCTED. Here is the physical stack, captured");
        Console.WriteLine("  inside the same method at the same moment, after the suspension:");
        Console.WriteLine();
        foreach (var line in PhysicalStackAsync().GetAwaiter().GetResult().Split('\n').Take(6))
            Console.WriteLine("    " + line.TrimEnd());
        Console.WriteLine();
        Console.WriteLine("  No Middle. No Outer. No Main. The thread running this code has never");
        Console.WriteLine("  heard of them — it picked the continuation off the pool queue. Those");
        Console.WriteLine("  frames were on a stack that unwound when the method first suspended.");
        Console.WriteLine("  The exception trace can show them only because each await records the");
        Console.WriteLine("  frame on the way through and the runtime stitches them together.");
        Console.WriteLine();
        Console.WriteLine("  This is the practical consequence: anything that reads the CURRENT");
        Console.WriteLine("  stack rather than an exception sees the short version. That includes");
        Console.WriteLine("  most profilers' sampled stacks, clrstack in a dump, and any logging");
        Console.WriteLine("  helper that calls new StackTrace() to work out who called it.");

        Console.WriteLine();
        Console.WriteLine("=== 2. async void: the exception the caller cannot catch ===");
        Console.WriteLine();
        Console.WriteLine("  This is inside a try/catch. Watch it not work.");

        var previous = SynchronizationContext.Current;
        var trap = new TrappingContext();
        SynchronizationContext.SetSynchronizationContext(trap);
        try
        {
            try
            {
                FireAndForgetAsync();          // async void
                Thread.Sleep(150);             // let it fail
                Console.WriteLine("  the catch block did NOT run");
            }
            catch (InvalidOperationException)
            {
                Console.WriteLine("  caught it (this line does not print)");
            }
        }
        finally
        {
            SynchronizationContext.SetSynchronizationContext(previous);
        }

        Console.WriteLine($"  the exception went here instead : {trap.Captured?.GetType().Name} " +
                          $"\"{trap.Captured?.Message}\"");
        Console.WriteLine();
        Console.WriteLine("  An async void method has no Task, so there is nothing to await and");
        Console.WriteLine("  nothing to hold the exception. AsyncVoidMethodBuilder rethrows it on");
        Console.WriteLine("  the captured SynchronizationContext instead.");
        Console.WriteLine("  Here a test context caught it. In ASP.NET Core there is no context, so");
        Console.WriteLine("  it is rethrown on a thread pool thread and TERMINATES THE PROCESS.");
        Console.WriteLine("  That is the whole rule: async void only for event handlers, never for");
        Console.WriteLine("  anything else, because it converts a handled error into a crash.");

        Console.WriteLine();
        Console.WriteLine("=== 3. the async lambda that silently became async void ===");
        Console.WriteLine();
        Action asVoid = async () => { await Task.Delay(10); };
        Func<Task> asTask = async () => { await Task.Delay(10); };
        Console.WriteLine($"  async () => {{ ... }} assigned to Action     : returns {DelegateReturn(asVoid)}");
        Console.WriteLine($"  the same lambda assigned to Func<Task>     : returns {DelegateReturn(asTask)}");
        Console.WriteLine();
        Console.WriteLine("  Identical source text, different compiled shape, decided entirely by");
        Console.WriteLine("  the type it was assigned to. Any API taking an Action or a void-");
        Console.WriteLine("  returning delegate will silently take an async lambda and give you");
        Console.WriteLine("  case 2. List.ForEach, Timer callbacks, older event APIs and many test");
        Console.WriteLine("  helpers are all shaped this way.");
        Console.WriteLine("  The tell is that the call site does not await anything and nobody");
        Console.WriteLine("  complains — because there is no Task to complain about.");

        Console.WriteLine();
        Console.WriteLine("=== 4. the unobserved Task: a failure with no symptom ===");
        Console.WriteLine();
        var dropped = FailingAsync();          // never awaited
        Thread.Sleep(150);
        Console.WriteLine($"  the task faulted          : {dropped.IsFaulted}");
        Console.WriteLine($"  it holds                  : {dropped.Exception?.InnerException?.Message}");
        Console.WriteLine("  and nothing was printed, logged or thrown.");
        dropped = null;
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        Console.WriteLine("  Even after collection, still silent: since .NET 4.5 an unobserved");
        Console.WriteLine("  Task exception does NOT crash the process. It evaporates.");
        Console.WriteLine("  This is the quietest failure in .NET. The symptom is not an error —");
        Console.WriteLine("  it is a piece of work that never happened.");
        Console.WriteLine("  Subscribe to TaskScheduler.UnobservedTaskException to find them:");

        var seen = 0;
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Interlocked.Increment(ref seen);
            e.SetObserved();
        };
        _ = FailingAsync();
        Thread.Sleep(150);
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        Thread.Sleep(50);
        Console.WriteLine($"  UnobservedTaskException fired : {seen} time(s)");

        Console.WriteLine();
        Console.WriteLine("=== 5. what a suspended state machine looks like in a dump ===");
        Console.WriteLine();
        var pending = StuckAsync();
        Thread.Sleep(100);
        Console.WriteLine($"  the task status is        : {pending.Status}");
        Console.WriteLine($"  threads in the process    : {Process.GetCurrentProcess().Threads.Count}");
        Console.WriteLine("  There is no thread to find. The method is suspended, so it appears in");
        Console.WriteLine("  NO stack trace on NO thread — it exists only as a boxed state machine");
        Console.WriteLine("  object on the heap, referenced by whatever will complete it.");
        Console.WriteLine();
        Console.WriteLine("  This is why 'clrstack -all' finds nothing for a hung async request and");
        Console.WriteLine("  why people conclude the request vanished. The command that does find");
        Console.WriteLine("  it walks the heap instead of the stacks:");
        Console.WriteLine();
        Console.WriteLine("    dotnet-dump collect --process-id <pid>");
        Console.WriteLine("    dotnet-dump analyze <file>");
        Console.WriteLine("    > dumpasync                 all suspended state machines");
        Console.WriteLine("    > dumpasync --stats         grouped by type, to find the pile-up");
        Console.WriteLine("    > dumpasync --completed     include ones that have finished");
        Console.WriteLine();
        Console.WriteLine("  dumpasync reconstructs the logical async call chain from the heap: for");
        Console.WriteLine("  each state machine it shows the type, the state field, and the machine");
        Console.WriteLine("  that will be resumed when it completes. That chain is the stack trace");
        Console.WriteLine("  the physical stacks no longer have.");
        Console.WriteLine();
        Console.WriteLine("  What to look for: thousands of the SAME state machine type all sitting");
        Console.WriteLine("  at the same state number means thousands of requests are blocked on the");
        Console.WriteLine("  same await. The state number tells you WHICH await — count the awaits");
        Console.WriteLine("  in the method body and the resume points are numbered in order.");

        var machine = typeof(Program).Assembly.GetTypes()
            .First(t => t.Name.Contains("StuckAsync"));
        Console.WriteLine();
        Console.WriteLine($"  in this process that type is : {machine.Name}");
        Console.WriteLine($"  and its state field is       : " +
            $"{machine.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public).First().Name}");
    }

    static async Task<string> PhysicalStackAsync()
    {
        await Task.Delay(10).ConfigureAwait(false);
        return new StackTrace(fNeedFileInfo: false).ToString();
    }

    static async Task OuterAsync()
    {
        await MiddleAsync().ConfigureAwait(false);
    }

    static async Task MiddleAsync()
    {
        await InnerAsync().ConfigureAwait(false);
    }

    static async Task InnerAsync()
    {
        await Task.Delay(10).ConfigureAwait(false);
        throw new InvalidOperationException("the original failure");
    }

    static async void FireAndForgetAsync()
    {
        await Task.Delay(20).ConfigureAwait(true);
        throw new InvalidOperationException("nobody can catch me");
    }

    static async Task FailingAsync()
    {
        await Task.Delay(20).ConfigureAwait(false);
        throw new InvalidOperationException("dropped on the floor");
    }

    static async Task StuckAsync()
    {
        await new TaskCompletionSource<int>().Task.ConfigureAwait(false);
    }

    static string DelegateReturn(Delegate d) =>
        d.Method.ReturnType == typeof(void) ? "void  — this is async void" : d.Method.ReturnType.Name;
}

/// <summary>Stands in for a UI or test context so an async void failure is visible.</summary>
sealed class TrappingContext : SynchronizationContext
{
    public Exception? Captured { get; private set; }

    public override void Post(SendOrPostCallback d, object? state)
    {
        try { d(state); }
        catch (Exception ex) { Captured = ex; }
    }

    public override void Send(SendOrPostCallback d, object? state) => Post(d, state);
}
