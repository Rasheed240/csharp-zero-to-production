// 05-minimal-example.cs — the module's minimal example, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading.Tasks;

class Program
{
    // A method that waits, without holding a thread while it waits.
    static async Task<string> FetchAsync(string name, int milliseconds)
    {
        await Task.Delay(milliseconds);          // suspends here; the thread is released
        return $"{name} after {milliseconds} ms";
    }

    static async Task Main()
    {
        // SEQUENTIAL: each await finishes before the next call starts.
        var sw = Stopwatch.StartNew();
        Console.WriteLine(await FetchAsync("first", 200));
        Console.WriteLine(await FetchAsync("second", 200));
        Console.WriteLine($"sequential: {sw.ElapsedMilliseconds} ms");

        // CONCURRENT: both are started, then both are awaited.
        sw.Restart();
        var a = FetchAsync("first", 200);
        var b = FetchAsync("second", 200);
        foreach (var line in await Task.WhenAll(a, b)) Console.WriteLine(line);
        Console.WriteLine($"concurrent: {sw.ElapsedMilliseconds} ms");
    }
}
