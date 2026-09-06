// 05-minimal-example.cs — the module's minimal example, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs
#:property Nullable=enable

using System;
using System.Threading.Tasks;

class Program
{
    static async Task<int> AddAsync(int a, int b)
    {
        await Task.Delay(50);
        return a + b;
    }

    static async Task Main()
    {
        // The call returns a Task immediately. The work is already running.
        Task<int> pending = AddAsync(2, 3);

        Console.WriteLine($"before await : Status={pending.Status}, IsCompleted={pending.IsCompleted}");

        int result = await pending;

        Console.WriteLine($"after await  : Status={pending.Status}, Result={result}");
        Console.WriteLine($"awaited again: {await pending}   (the body did not run twice)");

        // A Task that has already failed carries the exception until observed.
        Task failed = Task.FromException(new InvalidOperationException("declined"));
        Console.WriteLine($"failed task  : Status={failed.Status}");
        try
        {
            await failed;
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"awaiting it  : threw {ex.GetType().Name}: {ex.Message}");
        }
    }
}
