// 03-hash-quality.cs — a legal but poor GetHashCode is a correctness-preserving
// way to turn a hash table into a linked list.
// .NET 10.0.400, Release. Run: dotnet run 03-hash-quality.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;

readonly struct GoodKey : IEquatable<GoodKey>
{
    public readonly int A, B;
    public GoodKey(int a, int b) { A = a; B = b; }
    public bool Equals(GoodKey other) => A == other.A && B == other.B;
    public override bool Equals(object? o) => o is GoodKey k && Equals(k);
    public override int GetHashCode() => HashCode.Combine(A, B);
}

readonly struct ConstantKey : IEquatable<ConstantKey>
{
    public readonly int A, B;
    public ConstantKey(int a, int b) { A = a; B = b; }
    public bool Equals(ConstantKey other) => A == other.A && B == other.B;
    public override bool Equals(object? o) => o is ConstantKey k && Equals(k);
    public override int GetHashCode() => 1;                 // legal. Ruinous.
}

readonly struct XorKey : IEquatable<XorKey>
{
    public readonly int A, B;
    public XorKey(int a, int b) { A = a; B = b; }
    public bool Equals(XorKey other) => A == other.A && B == other.B;
    public override bool Equals(object? o) => o is XorKey k && Equals(k);
    // A common hand-rolled version. Fine here, but A^B collides for every
    // pair that swaps: (1,2) and (2,1) share a hash.
    public override int GetHashCode() => A ^ B;
}

class Program
{
    static void Run<T>(string label, Func<int, int, T> make, int n) where T : notnull
    {
        var dict = new Dictionary<T, int>(n);
        var sw = Stopwatch.StartNew();
        for (int i = 0; i < n; i++) dict[make(i, i * 7)] = i;
        sw.Stop();
        double insertMs = sw.Elapsed.TotalMilliseconds;

        sw.Restart();
        int found = 0;
        for (int i = 0; i < n; i++) if (dict.ContainsKey(make(i, i * 7))) found++;
        sw.Stop();

        Console.WriteLine($"  {label,-22} n={n,6:N0}  insert {insertMs,8:F1} ms   " +
                          $"lookup {sw.Elapsed.TotalMilliseconds,8:F1} ms   found {found:N0}");
    }

    static void Main()
    {
        // Warm up so the first measured row is not paying for JIT compilation.
        for (int w = 0; w < 3; w++)
        {
            var warm = new Dictionary<GoodKey, int>();
            for (int i = 0; i < 2000; i++) warm[new GoodKey(i, i * 7)] = i;
            var warm2 = new Dictionary<XorKey, int>();
            for (int i = 0; i < 2000; i++) warm2[new XorKey(i, i * 7)] = i;
            var warm3 = new Dictionary<ConstantKey, int>();
            for (int i = 0; i < 200; i++) warm3[new ConstantKey(i, i * 7)] = i;
        }

        Console.WriteLine("Same keys, same equality, different GetHashCode:");
        Console.WriteLine();
        foreach (int n in new[] { 1_000, 10_000, 40_000 })
        {
            Run("HashCode.Combine", (a, b) => new GoodKey(a, b), n);
            Run("A ^ B", (a, b) => new XorKey(a, b), n);
            Run("constant 1", (a, b) => new ConstantKey(a, b), n);
            Console.WriteLine();
        }

        Console.WriteLine("Collision behaviour of A ^ B for swapped pairs:");
        Console.WriteLine($"  new XorKey(1, 2).GetHashCode() : {new XorKey(1, 2).GetHashCode()}");
        Console.WriteLine($"  new XorKey(2, 1).GetHashCode() : {new XorKey(2, 1).GetHashCode()}");
        Console.WriteLine($"  are they equal?                : {new XorKey(1, 2).Equals(new XorKey(2, 1))}");
        Console.WriteLine("  Legal — rule 2 allows it — but every swapped pair shares a bucket.");
        Console.WriteLine($"  HashCode.Combine(1,2) vs (2,1)  : " +
                          $"{HashCode.Combine(1, 2)} vs {HashCode.Combine(2, 1)}");
    }
}
