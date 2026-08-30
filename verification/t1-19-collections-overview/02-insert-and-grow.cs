// 02-insert-and-grow.cs — where you add matters more than what you add to, and
// pre-sizing removes a cost most code pays silently.
// .NET 10.0.400, Release. Run: dotnet run 02-insert-and-grow.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;

class Program
{
    static (double ms, long bytes) Measure(Action body)
    {
        body();
        double best = double.MaxValue;
        long bytes = 0;
        for (int r = 0; r < 3; r++)
        {
            long before = GC.GetTotalAllocatedBytes(precise: true);
            var sw = Stopwatch.StartNew();
            body();
            sw.Stop();
            bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        return (best, bytes);
    }

    static void Show(string label, (double ms, long bytes) r) =>
        Console.WriteLine($"  {label,-34} {r.ms,8:F1} ms   {r.bytes,12:N0} bytes");

    static void Main()
    {
        const int N = 100_000;

        Console.WriteLine($"--- adding {N:N0} items ---");
        Show("List.Add (no capacity)", Measure(() =>
        {
            var l = new List<int>();
            for (int i = 0; i < N; i++) l.Add(i);
        }));
        Show("List.Add (pre-sized)", Measure(() =>
        {
            var l = new List<int>(N);
            for (int i = 0; i < N; i++) l.Add(i);
        }));
        Show("List.Insert(0, ...)", Measure(() =>
        {
            var l = new List<int>(N);
            for (int i = 0; i < N; i++) l.Insert(0, i);
        }));
        Show("Queue.Enqueue", Measure(() =>
        {
            var q = new Queue<int>();
            for (int i = 0; i < N; i++) q.Enqueue(i);
        }));
        Show("LinkedList.AddFirst", Measure(() =>
        {
            var ll = new LinkedList<int>();
            for (int i = 0; i < N; i++) ll.AddFirst(i);
        }));

        Console.WriteLine();
        Console.WriteLine($"--- adding {N:N0} keys ---");
        Show("Dictionary (no capacity)", Measure(() =>
        {
            var d = new Dictionary<int, int>();
            for (int i = 0; i < N; i++) d[i] = i;
        }));
        Show("Dictionary (pre-sized)", Measure(() =>
        {
            var d = new Dictionary<int, int>(N);
            for (int i = 0; i < N; i++) d[i] = i;
        }));
        Show("SortedDictionary", Measure(() =>
        {
            var d = new SortedDictionary<int, int>();
            for (int i = 0; i < N; i++) d[i] = i;
        }));
        Show("SortedList", Measure(() =>
        {
            var d = new SortedList<int, int>();
            for (int i = 0; i < N; i++) d[i] = i;
        }));

        Console.WriteLine();
        Console.WriteLine("--- how a List grows ---");
        var probe = new List<int>();
        int lastCapacity = -1;
        int reallocations = 0;
        var capacities = new List<int>();
        for (int i = 0; i < 5000; i++)
        {
            probe.Add(i);
            if (probe.Capacity != lastCapacity)
            {
                lastCapacity = probe.Capacity;
                reallocations++;
                if (capacities.Count < 14) capacities.Add(lastCapacity);
            }
        }
        Console.WriteLine($"  capacities seen : {string.Join(", ", capacities)} ...");
        Console.WriteLine($"  reallocations for 5,000 adds : {reallocations}");
        Console.WriteLine("  Each one allocates a new array and copies everything across.");
        Console.WriteLine("  Total copying is about 2n element moves — amortised O(1) per add,");
        Console.WriteLine("  and entirely avoidable when the size is known in advance.");
    }
}
