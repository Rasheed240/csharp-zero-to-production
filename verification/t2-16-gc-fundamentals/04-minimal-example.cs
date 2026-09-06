// 04-minimal-example.cs — the smallest program showing promotion, and what it
// costs when objects survive.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;

class Program
{
    static void Main()
    {
        // Everything starts in gen 0. Surviving a collection promotes it.
        var obj = new byte[64];
        Console.WriteLine($"freshly allocated  : gen {GC.GetGeneration(obj)}");
        GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"survived one gen 0 : gen {GC.GetGeneration(obj)}");
        GC.Collect(1, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"survived one gen 1 : gen {GC.GetGeneration(obj)}");
        GC.KeepAlive(obj);

        // The same total allocation, dropped versus kept.
        Console.WriteLine();
        Console.WriteLine("300,000 objects, same total bytes:");
        Console.WriteLine($"  dropped : {Counts(keep: false)}");
        Console.WriteLine($"  kept    : {Counts(keep: true)}");
        Console.WriteLine();
        Console.WriteLine("The GC charges for what LIVES, not for what you allocate.");
    }

    static string Counts(bool keep)
    {
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        int g0 = GC.CollectionCount(0), g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);

        List<byte[]>? held = keep ? new List<byte[]>(300_000) : null;
        for (var i = 0; i < 300_000; i++)
        {
            var b = new byte[256];
            if (held is not null) held.Add(b); else GC.KeepAlive(b);
        }
        GC.KeepAlive(held);

        return $"gen0 {GC.CollectionCount(0) - g0,3}, gen1 {GC.CollectionCount(1) - g1,3}, " +
               $"gen2 {GC.CollectionCount(2) - g2,3}";
    }
}
