// 06-minimal-example.cs — the smallest program that shows an async method's
// state machine and the local that had to become a field.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 06-minimal-example.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;

class Program
{
    static async Task<int> DoubleAfterDelayAsync(int value)
    {
        await Task.Delay(10).ConfigureAwait(false);
        return value * 2;                        // 'value' is used AFTER the await
    }

    static void Main()
    {
        Console.WriteLine($"result : {DoubleAfterDelayAsync(21).GetAwaiter().GetResult()}");

        var machine = typeof(Program).Assembly.GetTypes()
            .Single(t => t.Name.Contains("DoubleAfterDelayAsync"));

        Console.WriteLine($"machine: {machine.Name}");
        Console.WriteLine($"struct : {machine.IsValueType}");
        foreach (var f in machine.GetFields(BindingFlags.Instance |
                                            BindingFlags.Public | BindingFlags.NonPublic))
            Console.WriteLine($"field  : {f.FieldType.Name} {f.Name}");
    }
}
