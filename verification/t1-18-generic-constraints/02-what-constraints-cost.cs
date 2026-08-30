// 02-what-constraints-cost.cs — the new() constraint and the interface
// constraint both have a performance story, and only one of them is the one
// people expect.
// .NET 10.0.400, Release. Run: dotnet run 02-what-constraints-cost.cs -c Release

// IL2087 is about trimming analysis of Activator.CreateInstance, which is the
// comparison being made here rather than a defect.
#:property NoWarn=IL2087

using System;
using System.Diagnostics;

sealed class Item { public int Value = 1; }

interface IShape { double Area(); }

// A struct implementing an interface. Calling through the interface without a
// constraint boxes; with a struct constraint the JIT can call directly.
readonly struct Square : IShape
{
    private readonly double _side;
    public Square(double side) => _side = side;
    public double Area() => _side * _side;
}

class Program
{
    const int N = 10_000_000;

    // Three ways to create a T.
    static T ViaConstraint<T>() where T : new() => new T();
    static T ViaActivator<T>() => (T)Activator.CreateInstance(typeof(T))!;
    static T ViaFactory<T>(Func<T> make) => make();

    // Calling an interface member: unconstrained (boxes) vs struct-constrained.
    static double SumBoxed(IShape shape)
    {
        double total = 0;
        for (int i = 0; i < N; i++) total += shape.Area();
        return total;
    }

    static double SumConstrained<T>(T shape) where T : struct, IShape
    {
        double total = 0;
        for (int i = 0; i < N; i++) total += shape.Area();
        return total;
    }

    static void Time(string label, Func<double> body, int n)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            double v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-34} {best,7:F1} ms   {best * 1e6 / n,5:F2} ns/op");
    }

    static void Main()
    {
        const int Creations = 2_000_000;

        Console.WriteLine($"--- creating {Creations:N0} objects three ways ---");
        Time("new T() via new() constraint", () =>
        {
            double n = 0;
            for (int i = 0; i < Creations; i++) n += ViaConstraint<Item>().Value + 1;
            return n;
        }, Creations);

        Time("Activator.CreateInstance", () =>
        {
            double n = 0;
            for (int i = 0; i < Creations; i++) n += ViaActivator<Item>().Value + 1;
            return n;
        }, Creations);

        Time("Func<T> factory parameter", () =>
        {
            double n = 0;
            for (int i = 0; i < Creations; i++) n += ViaFactory(() => new Item()).Value + 1;
            return n;
        }, Creations);

        Console.WriteLine();
        Console.WriteLine($"--- calling an interface member {N:N0} times on a struct ---");
        var square = new Square(3);
        Time("through IShape (boxed)", () => SumBoxed(square), N);
        Time("where T : struct, IShape", () => SumConstrained(square), N);

        Console.WriteLine();
        Console.WriteLine("--- allocation ---");
        long before = GC.GetTotalAllocatedBytes(true);
        SumBoxedOnce(square);
        Console.WriteLine($"  one boxed call allocated      : {GC.GetTotalAllocatedBytes(true) - before} bytes");
        before = GC.GetTotalAllocatedBytes(true);
        SumConstrainedOnce(square);
        Console.WriteLine($"  one constrained call allocated: {GC.GetTotalAllocatedBytes(true) - before} bytes");
    }

    static double SumBoxedOnce(IShape s) => s.Area();
    static double SumConstrainedOnce<T>(T s) where T : struct, IShape => s.Area();
}
