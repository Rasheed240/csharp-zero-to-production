// 04-struct-equality.cs — a struct that does not implement IEquatable<T> gets
// equality from ValueType, which falls back to reflection over its fields when
// it cannot compare the bytes directly.
// .NET 10.0.400, Release. Run: dotnet run 04-struct-equality.cs -c Release

#:property NoWarn=IL2075;IL3050

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

// No IEquatable. Contains a reference field, so byte comparison is impossible.
struct SlowPoint
{
    public int X, Y;
    public string Label;
    public SlowPoint(int x, int y, string label) { X = x; Y = y; Label = label; }
}

// Same data, with IEquatable<T> implemented.
struct FastPoint : IEquatable<FastPoint>
{
    public int X, Y;
    public string Label;
    public FastPoint(int x, int y, string label) { X = x; Y = y; Label = label; }

    public bool Equals(FastPoint other) => X == other.X && Y == other.Y && Label == other.Label;
    public override bool Equals(object? o) => o is FastPoint p && Equals(p);
    public override int GetHashCode() => HashCode.Combine(X, Y, Label);
}

// The compiler writes both for a record struct.
readonly record struct RecordPoint(int X, int Y, string Label);

class Program
{
    const int N = 2_000_000;

    static void Time<T>(string label, T a, T b)
    {
        var cmp = EqualityComparer<T>.Default;
        for (int i = 0; i < 10_000; i++) cmp.Equals(a, b);

        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            int n = 0;
            for (int i = 0; i < N; i++) if (cmp.Equals(a, b)) n++;
            sw.Stop();
            if (n != N) throw new Exception("not equal");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-34} {best,7:F1} ms   {best * 1e6 / N,6:F1} ns/compare");
    }

    static void Main()
    {
        Console.WriteLine($"{N:N0} comparisons, best of 5");
        Console.WriteLine();

        Time("struct, no IEquatable", new SlowPoint(1, 2, "a"), new SlowPoint(1, 2, "a"));
        Time("struct with IEquatable<T>", new FastPoint(1, 2, "a"), new FastPoint(1, 2, "a"));
        Time("readonly record struct", new RecordPoint(1, 2, "a"), new RecordPoint(1, 2, "a"));

        Console.WriteLine();
        Console.WriteLine("Which Equals each one actually uses:");
        foreach (var t in new[] { typeof(SlowPoint), typeof(FastPoint), typeof(RecordPoint) })
        {
            bool implementsIt = t.GetInterfaces().Any(i => i.IsGenericType &&
                i.GetGenericTypeDefinition() == typeof(IEquatable<>));
            Console.WriteLine($"  {t.Name,-16} IEquatable<T>: {implementsIt,-6} " +
                              $"comparer: {GetComparerName(t)}");
        }

        Console.WriteLine();
        Console.WriteLine("Boxing: calling the object-based Equals allocates for a struct.");
        long before = GC.GetTotalAllocatedBytes(precise: true);
        var s1 = new SlowPoint(1, 2, "a");
        object boxed = s1;
        for (int i = 0; i < 1000; i++) _ = s1.Equals(boxed);
        long after = GC.GetTotalAllocatedBytes(precise: true);
        Console.WriteLine($"  1000 calls to Equals(object) allocated {after - before:N0} bytes");
    }

    static string GetComparerName(Type t)
    {
        var comparerType = typeof(EqualityComparer<>).MakeGenericType(t);
        var prop = comparerType.GetProperty("Default")!;
        return prop.GetValue(null)!.GetType().Name;
    }
}
