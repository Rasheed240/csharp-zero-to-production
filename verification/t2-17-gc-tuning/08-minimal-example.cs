// 08-minimal-example.cs — The whole module in one screen: 25% more bytes moves a
// buffer onto a heap that is never compacted, and the collection profile changes
// completely.
//
// Run:  dotnet run 08-minimal-example.cs -c Release

using System.Diagnostics;

// 24 bytes of header on 64-bit, so the last byte[] that stays on the normal
// heap has 84,975 elements.
Console.WriteLine($"byte[84,975] -> gen {GC.GetGeneration(new byte[84_975])}   (84,999 bytes total)");
Console.WriteLine($"byte[84,976] -> gen {GC.GetGeneration(new byte[84_976])}   (85,000 bytes total)");
Console.WriteLine();

Measure(80_000);
Measure(100_000);

Console.WriteLine();
Console.WriteLine("Same loop, same work, 25% more bytes per buffer.");
Console.WriteLine("Below the threshold the buffers die in gen 0 and cost nothing.");
Console.WriteLine("Above it they are born in gen 2 and only a full collection frees them.");

static void Measure(int size)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    int gen0 = GC.CollectionCount(0);
    int gen2 = GC.CollectionCount(2);
    var sw = Stopwatch.StartNew();

    long sink = 0;
    for (int i = 0; i < 20_000; i++)
    {
        var buffer = new byte[size];
        buffer[0] = (byte)i;
        sink += buffer[0];
    }

    sw.Stop();
    Console.WriteLine($"byte[{size:N0}] x 20,000 : " +
        $"gen0 {GC.CollectionCount(0) - gen0,5}, gen2 {GC.CollectionCount(2) - gen2,5}, " +
        $"{sw.Elapsed.TotalMilliseconds,6:F0} ms   (sink {sink})");
}
