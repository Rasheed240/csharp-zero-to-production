// 07-minimal-example.cs — the module's minimal example, run.
// .NET 10.0.400. Run: dotnet run 07-minimal-example.cs

using System;
using System.Globalization;

class Program
{
    static string Render(object? value) => value switch
    {
        null => "(none)",
        string { Length: 0 } => "(empty)",
        string s => s,
        int and < 0 => "(negative)",
        int n => n.ToString("N0", CultureInfo.InvariantCulture),
        decimal d => d.ToString("N2", CultureInfo.InvariantCulture),
        bool b => b ? "yes" : "no",
        _ => value.ToString() ?? "(none)"
    };

    static void Main()
    {
        object?[] values = { null, "", "hello", -3, 12345, 9.5m, true, DateTime.MaxValue };
        foreach (var v in values)
        {
            var shown = v?.ToString() ?? "null";
            Console.WriteLine($"{shown,-22} -> {Render(v)}");
        }
    }
}
