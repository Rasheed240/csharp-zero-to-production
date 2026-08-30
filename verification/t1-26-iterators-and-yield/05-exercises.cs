// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 05-exercises.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static readonly List<string> Log = new();

    static IEnumerable<int> Traced()
    {
        Log.Add("A");
        yield return 1;
        Log.Add("B");
        yield return 2;
        Log.Add("C");
    }

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: when does the body run? =====");
        Log.Clear();
        var seq = Traced();
        Console.WriteLine($"  after calling Traced()      : [{string.Join(",", Log)}]");
        var e = seq.GetEnumerator();
        Console.WriteLine($"  after GetEnumerator()       : [{string.Join(",", Log)}]");
        e.MoveNext();
        Console.WriteLine($"  after first MoveNext()      : [{string.Join(",", Log)}] Current={e.Current}");
        e.MoveNext();
        Console.WriteLine($"  after second MoveNext()     : [{string.Join(",", Log)}] Current={e.Current}");
        Console.WriteLine($"  third MoveNext() returns    : {e.MoveNext()}");
        Console.WriteLine($"  log now                     : [{string.Join(",", Log)}]");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: validation that never runs =====");
        try
        {
            var q = TakeEveryNthBroken(new[] { 1, 2, 3 }, 0);
            Console.WriteLine("  broken version: call returned without throwing");
            foreach (var x in q) { }
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  broken version: threw only on enumeration ({ex.ParamName})");
        }
        try
        {
            _ = TakeEveryNth(new[] { 1, 2, 3 }, 0);
            Console.WriteLine("  fixed version: call returned without throwing");
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  fixed version : threw at the call site ({ex.ParamName})");
        }
        Console.WriteLine($"  and still works: {string.Join(", ", TakeEveryNth(Enumerable.Range(1, 10).ToArray(), 3))}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which finally blocks run? =====");
        Console.WriteLine("  (a) full foreach:");
        foreach (var n in Resourceful("a")) { }
        Console.WriteLine("  (b) foreach with break at 2:");
        foreach (var n in Resourceful("b")) if (n == 2) break;
        Console.WriteLine("  (c) LINQ First():");
        _ = Resourceful("c").First();
        Console.WriteLine("  (d) manual MoveNext, never disposed:");
        var abandoned = Resourceful("d").GetEnumerator();
        abandoned.MoveNext();
        abandoned = null!;
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        Console.WriteLine("      (no CLOSE line for d)");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: the reused-buffer bug =====");
        var source = Enumerable.Range(1, 9).ToArray();

        Console.WriteLine("  reusing one array:");
        foreach (var chunk in ChunkReusingBuffer(source, 3))
            Console.WriteLine($"    while streaming : {string.Join(",", chunk)}");
        var collected = ChunkReusingBuffer(source, 3).ToList();
        Console.WriteLine($"    after ToList()  : {string.Join(" | ", collected.Select(c => string.Join(",", c)))}");
        Console.WriteLine($"    all three are the same array : " +
                          $"{ReferenceEquals(collected[0], collected[1]) && ReferenceEquals(collected[1], collected[2])}");

        Console.WriteLine("  allocating per chunk:");
        var safe = ChunkSafe(source, 3).ToList();
        Console.WriteLine($"    after ToList()  : {string.Join(" | ", safe.Select(c => string.Join(",", c)))}");
        Console.WriteLine($"    all three are the same array : " +
                          $"{ReferenceEquals(safe[0], safe[1]) && ReferenceEquals(safe[1], safe[2])}");

        Console.WriteLine();
        var bytesReuse = AllocOf(() => { foreach (var c in ChunkReusingBuffer(BigSource, 100)) Touch(c); });
        var bytesSafe = AllocOf(() => { foreach (var c in ChunkSafe(BigSource, 100)) Touch(c); });
        Console.WriteLine($"  streaming 100,000 items in chunks of 100:");
        Console.WriteLine($"    reused buffer   : {bytesReuse:N0} bytes");
        Console.WriteLine($"    fresh per chunk : {bytesSafe:N0} bytes");
        Console.WriteLine($"    ratio           : {(double)bytesSafe / bytesReuse:0.0}x");
    }

    static readonly int[] BigSource = Enumerable.Range(1, 100_000).ToArray();
    static long _sink;
    static void Touch(int[] chunk) => _sink += chunk.Length;

    static IEnumerable<int> TakeEveryNthBroken(IReadOnlyList<int> source, int n)
    {
        if (n <= 0) throw new ArgumentOutOfRangeException(nameof(n));
        for (var i = 0; i < source.Count; i += n) yield return source[i];
    }

    static IEnumerable<int> TakeEveryNth(IReadOnlyList<int> source, int n)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (n <= 0) throw new ArgumentOutOfRangeException(nameof(n));
        return Iterate(source, n);

        static IEnumerable<int> Iterate(IReadOnlyList<int> source, int n)
        {
            for (var i = 0; i < source.Count; i += n) yield return source[i];
        }
    }

    static IEnumerable<int> Resourceful(string label)
    {
        try
        {
            yield return 1;
            yield return 2;
            yield return 3;
        }
        finally
        {
            Console.WriteLine($"      CLOSE {label}");
        }
    }

    static IEnumerable<int[]> ChunkReusingBuffer(IReadOnlyList<int> source, int size)
    {
        var buffer = new int[size];
        var used = 0;
        foreach (var item in source)
        {
            buffer[used++] = item;
            if (used == size) { used = 0; yield return buffer; }
        }
        if (used > 0) yield return buffer[..used];
    }

    static IEnumerable<int[]> ChunkSafe(IReadOnlyList<int> source, int size)
    {
        var buffer = new List<int>(size);
        foreach (var item in source)
        {
            buffer.Add(item);
            if (buffer.Count == size) { yield return buffer.ToArray(); buffer.Clear(); }
        }
        if (buffer.Count > 0) yield return buffer.ToArray();
    }

    static long AllocOf(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        a();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }
}
