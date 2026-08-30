// 07-exercises.cs — every answer claimed in this module's exercises, run.
// The CS0659 warning on Exercise1Key is deliberate; see 01-the-contract.cs.
#:property NoWarn=CS0659

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

// ===== Exercise 1 ==========================================================
sealed class Exercise1Key
{
    public string Region { get; }
    public Exercise1Key(string region) => Region = region;
    public override bool Equals(object? o) => o is Exercise1Key k && k.Region == Region;
    // GetHashCode deliberately absent.
}

// ===== Exercise 2 ==========================================================
sealed class Coord
{
    public int X { get; }
    public int Y { get; }
    public Coord(int x, int y) { X = x; Y = y; }
    public override bool Equals(object? o) => o is Coord c && c.X == X && c.Y == Y;
    public override int GetHashCode() => X ^ Y;                 // the candidate
}

sealed class CoordCombined
{
    public int X { get; }
    public int Y { get; }
    public CoordCombined(int x, int y) { X = x; Y = y; }
    public override bool Equals(object? o) => o is CoordCombined c && c.X == X && c.Y == Y;
    public override int GetHashCode() => HashCode.Combine(X, Y);
}

// ===== Exercise 4 ==========================================================
struct Reading { public int Sensor; public double Value; public string Unit; }

struct FastReading : IEquatable<FastReading>
{
    public int Sensor; public double Value; public string Unit;
    public bool Equals(FastReading o) => Sensor == o.Sensor && Value.Equals(o.Value) && Unit == o.Unit;
    public override bool Equals(object? o) => o is FastReading r && Equals(r);
    public override int GetHashCode() => HashCode.Combine(Sensor, Value, Unit);
}

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1 =====");
        var a = new Exercise1Key("eu-west-2");
        var b = new Exercise1Key("eu-west-2");
        var d = new Dictionary<Exercise1Key, string> { [a] = "london" };
        Console.WriteLine($"  a.Equals(b)          : {a.Equals(b)}");
        Console.WriteLine($"  ContainsKey(a)       : {d.ContainsKey(a)}");
        Console.WriteLine($"  ContainsKey(b)       : {d.ContainsKey(b)}");
        Console.WriteLine($"  HashSet{{a, b}}.Count : {new HashSet<Exercise1Key> { a, b }.Count}");
        Console.WriteLine($"  List.Contains(b)     : {new List<Exercise1Key> { a }.Contains(b)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: collisions from X ^ Y =====");
        int collisions = 0, pairs = 0;
        var seen = new Dictionary<int, int>();
        for (int x = 0; x < 100; x++)
            for (int y = 0; y < 100; y++)
            {
                pairs++;
                int h = new Coord(x, y).GetHashCode();
                seen[h] = seen.GetValueOrDefault(h) + 1;
            }
        collisions = seen.Values.Where(c => c > 1).Sum(c => c - 1);
        Console.WriteLine($"  X^Y over 100x100 grid: {pairs} keys -> {seen.Count} distinct hashes");
        Console.WriteLine($"  colliding keys       : {collisions}");
        Console.WriteLine($"  largest group        : {seen.Values.Max()}");

        var seen2 = new Dictionary<int, int>();
        for (int x = 0; x < 100; x++)
            for (int y = 0; y < 100; y++)
            {
                int h = new CoordCombined(x, y).GetHashCode();
                seen2[h] = seen2.GetValueOrDefault(h) + 1;
            }
        Console.WriteLine($"  HashCode.Combine     : {pairs} keys -> {seen2.Count} distinct hashes");
        Console.WriteLine($"  colliding keys       : {seen2.Values.Where(c => c > 1).Sum(c => c - 1)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: IEquatable on a struct =====");
        const int N = 1_000_000;
        var slow = new Reading { Sensor = 1, Value = 2.5, Unit = "C" };
        var fast = new FastReading { Sensor = 1, Value = 2.5, Unit = "C" };
        Console.WriteLine($"  {Bench(slow, N)} ns/compare  (no IEquatable)");
        Console.WriteLine($"  {Bench(fast, N)} ns/compare  (IEquatable)");
    }

    static string Bench<T>(T value, int n)
    {
        var cmp = EqualityComparer<T>.Default;
        for (int i = 0; i < 10_000; i++) cmp.Equals(value, value);
        double best = double.MaxValue;
        for (int r = 0; r < 3; r++)
        {
            var sw = Stopwatch.StartNew();
            int c = 0;
            for (int i = 0; i < n; i++) if (cmp.Equals(value, value)) c++;
            sw.Stop();
            if (c != n) throw new Exception();
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        return (best * 1e6 / n).ToString("F1").PadLeft(6);
    }
}
