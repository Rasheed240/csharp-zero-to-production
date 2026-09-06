// 01-the-generated-type.cs — the struct the compiler writes for every async
// method, read out of the assembly's own metadata. Compare with t1-26, where the
// same technique showed the iterator state machine: this is the same idea with
// an awaiter instead of a Current.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-the-generated-type.cs
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;

class Program
{
    static async Task<int> AddAsync(int a, int b)
    {
        var partial = a + b;             // a local: becomes a FIELD
        await Task.Delay(10).ConfigureAwait(false);
        return partial * 2;
    }

    static async Task NoAwaitAsync()
    {
        await Task.CompletedTask;
    }

    static void Main()
    {
        Console.WriteLine("--- the compiler generated a type per async method ---");
        var generated = typeof(Program).Assembly.GetTypes()
            .Where(t => t.Name.Contains("d__"))
            .OrderBy(t => t.Name, StringComparer.Ordinal)
            .ToArray();

        foreach (var t in generated)
        {
            Console.WriteLine();
            Console.WriteLine($"  {t.Name}");
            Console.WriteLine($"    nested in   : {t.DeclaringType?.Name}");
            Console.WriteLine($"    is a STRUCT : {t.IsValueType}");
            Console.WriteLine($"    interfaces  : {string.Join(", ", t.GetInterfaces().Select(i => i.Name))}");
            var fields = t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            foreach (var f in fields)
                Console.WriteLine($"    field       : {f.FieldType.Name,-40} {f.Name}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what those fields are ---");
        Console.WriteLine("  <>1__state    the resume point. -1 means running or done.");
        Console.WriteLine("  <>t__builder  AsyncTaskMethodBuilder: owns the Task and decides");
        Console.WriteLine("                whether to complete synchronously or suspend.");
        Console.WriteLine("  <>u__1        the AWAITER for the thing being awaited. One field");
        Console.WriteLine("                per distinct awaiter type in the method.");
        Console.WriteLine("  a, b, partial the parameters and locals that must survive the");
        Console.WriteLine("                suspension. This is the key idea: a local that");
        Console.WriteLine("                lives across an await is not on the stack — it is");
        Console.WriteLine("                a field of an object that outlives the stack frame.");

        Console.WriteLine();
        Console.WriteLine("--- it is a STRUCT, which is the optimisation that matters ---");
        Console.WriteLine("  A struct state machine lives on the stack while the method runs");
        Console.WriteLine("  synchronously. If the method finishes without ever suspending, it");
        Console.WriteLine("  is never boxed and never reaches the heap.");
        Console.WriteLine("  Only when it must suspend does the builder box it onto the heap so");
        Console.WriteLine("  it can outlive the stack frame. That is why the allocation numbers");
        Console.WriteLine("  in 02-cost.cs differ so sharply between the two paths.");
        Console.WriteLine("  (In a Debug build it is generated as a CLASS instead, so this same");
        Console.WriteLine("  program compiled with -c Debug reports is-a-STRUCT False.)");

        Console.WriteLine();
        Console.WriteLine("--- MoveNext is the method body, rewritten ---");
        var machine = generated.FirstOrDefault(t => t.Name.Contains("AddAsync"));
        if (machine is not null)
        {
            var moveNext = machine.GetMethod("MoveNext",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            Console.WriteLine($"  MoveNext exists : {moveNext is not null}");
            Console.WriteLine($"  declared by     : {moveNext?.DeclaringType?.Name}");
            Console.WriteLine("  Your method body is now a switch on <>1__state inside MoveNext.");
            Console.WriteLine("  Each await is a case label: run to here, save state, return.");
            Console.WriteLine("  When the awaited thing completes, MoveNext is called again and");
            Console.WriteLine("  the switch jumps to where it left off.");
        }

        Console.WriteLine();
        Console.WriteLine("--- the awaiter pattern is structural, not an interface ---");
        var awaiter = Task.Delay(1).ConfigureAwait(false).GetAwaiter();
        var at = awaiter.GetType();
        Console.WriteLine($"  awaiter type    : {at.Name}");
        Console.WriteLine($"  IsCompleted     : {at.GetProperty("IsCompleted") is not null}");
        Console.WriteLine($"  GetResult()     : {at.GetMethod("GetResult") is not null}");
        Console.WriteLine($"  INotifyCompletion : {typeof(INotifyCompletion).IsAssignableFrom(at)}");
        Console.WriteLine("  await works on ANY type with GetAwaiter() returning something");
        Console.WriteLine("  with IsCompleted, GetResult() and OnCompleted(). No interface is");
        Console.WriteLine("  required — which is why you can await your own types, and why");
        Console.WriteLine("  an extension method can make a third-party type awaitable.");

        Console.WriteLine();
        Console.WriteLine("--- awaiting a custom type, to prove the point ---");
        var value = WaitForSomething().GetAwaiter().GetResult();
        Console.WriteLine($"  awaited a Countdown and got : {value}");
    }

    static async Task<string> WaitForSomething()
    {
        return await new Countdown(3);   // no ConfigureAwait: it is not a Task
    }
}

/// <summary>Awaitable without implementing any interface: it has GetAwaiter().</summary>
readonly struct Countdown
{
    private readonly int _from;
    public Countdown(int from) => _from = from;
    public CountdownAwaiter GetAwaiter() => new(_from);
}

readonly struct CountdownAwaiter : INotifyCompletion
{
    private readonly int _from;
    public CountdownAwaiter(int from) => _from = from;

    // Completing synchronously means await never suspends: no allocation.
    public bool IsCompleted => true;
    public string GetResult() => $"counted down from {_from}";
    public void OnCompleted(Action continuation) => continuation();
}
