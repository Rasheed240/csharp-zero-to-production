// 04-minimal-example.cs — the smallest program showing when parallelism helps
// and when it costs, with nothing else in the file.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"cores: {Environment.ProcessorCount}");
        Console.WriteLine();
        Console.WriteLine("work per item   sequential   Parallel.For   speed-up");
        Row("none", 0);
        Row("heavy", 2000);
    }

    static void Row(string label, int spin)
    {
        var seq = Time(() => { for (var i = 0; i < 20_000; i++) Spin(spin); });
        var par = Time(() => Parallel.For(0, 20_000, _ => Spin(spin)));
        Console.WriteLine($"{label,-13} {seq,11:N0} ms {par,11:N0} ms {seq / par,9:N2}x");
    }

    static void Spin(int n)
    {
        var h = 0;
        for (var i = 0; i < n; i++) h = HashCode.Combine(h, i);
        if (h == int.MinValue) _sink++;
    }

    static double Time(Action a)
    {
        a();                                  // warm up, so the JIT is not measured
        var sw = Stopwatch.StartNew();
        a();
        return sw.Elapsed.TotalMilliseconds;
    }
}
