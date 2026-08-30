// 03-struct-cost.cs — when a struct is cheaper than a class, and when it is
// not. Measured rather than assumed.
// .NET 10.0.400, Release, x64. Run: dotnet run 03-struct-cost.cs -c Release

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;

readonly record struct SmallStruct(int X, int Y);              // 8 bytes
sealed record SmallClass(int X, int Y);

readonly record struct BigStruct(
    long A, long B, long C, long D, long E, long F, long G, long H);   // 64 bytes
sealed record BigClass(long A, long B, long C, long D, long E, long F, long G, long H);

class Program
{
    const int N = 20_000_000;

    static long SumSmallStruct() { long t = 0; for (int i = 0; i < N; i++) { var v = new SmallStruct(i, i); t += Use(v); } return t; }
    static long SumSmallClass() { long t = 0; for (int i = 0; i < N; i++) { var v = new SmallClass(i, i); t += Use(v); } return t; }
    static long SumBigStruct() { long t = 0; for (int i = 0; i < N; i++) { var v = new BigStruct(i, i, i, i, i, i, i, i); t += Use(v); } return t; }
    static long SumBigClass() { long t = 0; for (int i = 0; i < N; i++) { var v = new BigClass(i, i, i, i, i, i, i, i); t += Use(v); } return t; }

    [MethodImpl(MethodImplOptions.NoInlining)] static long Use(SmallStruct v) => v.X + v.Y;
    [MethodImpl(MethodImplOptions.NoInlining)] static long Use(SmallClass v) => v.X + v.Y;
    [MethodImpl(MethodImplOptions.NoInlining)] static long Use(BigStruct v) => v.A + v.H;
    [MethodImpl(MethodImplOptions.NoInlining)] static long Use(BigClass v) => v.A + v.H;

    static void Time(string label, Func<long> body)
    {
        body();
        long before = GC.GetTotalAllocatedBytes(precise: false);
        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        long allocated = GC.GetTotalAllocatedBytes(precise: false) - before;
        Console.WriteLine($"  {label,-28} {best,7:F1} ms   ~{allocated / (5.0 * N),5:F1} bytes/iteration");
    }

    static void Main()
    {
        Console.WriteLine($"sizes: SmallStruct={Unsafe.SizeOf<SmallStruct>()} bytes, " +
                          $"BigStruct={Unsafe.SizeOf<BigStruct>()} bytes");
        Console.WriteLine($"a class instance also carries a 16-byte header on x64");
        Console.WriteLine($"N = {N:N0} per run, best of 5, gen0 collections counted below");
        Console.WriteLine();

        int gc0 = GC.CollectionCount(0);
        Time("small struct (8 B)", SumSmallStruct);
        Console.WriteLine($"    gen0 collections during that: {GC.CollectionCount(0) - gc0}");

        gc0 = GC.CollectionCount(0);
        Time("small class  (8 B + header)", SumSmallClass);
        Console.WriteLine($"    gen0 collections during that: {GC.CollectionCount(0) - gc0}");

        gc0 = GC.CollectionCount(0);
        Time("big struct   (64 B)", SumBigStruct);
        Console.WriteLine($"    gen0 collections during that: {GC.CollectionCount(0) - gc0}");

        gc0 = GC.CollectionCount(0);
        Time("big class    (64 B + header)", SumBigClass);
        Console.WriteLine($"    gen0 collections during that: {GC.CollectionCount(0) - gc0}");
    }
}
