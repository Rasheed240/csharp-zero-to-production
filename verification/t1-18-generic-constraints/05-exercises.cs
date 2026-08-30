// IL2087 concerns trimming analysis of Activator.CreateInstance, which is the
// comparison being made rather than a defect.
#:property NoWarn=IL2087

// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 05-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Numerics;

// ===== Exercise 2 ==========================================================
sealed class Node { public int Value = 1; }

// ===== Exercise 3 ==========================================================
interface IArea { double Area(); }
readonly struct Circle : IArea
{
    private readonly double _r;
    public Circle(double r) => _r = r;
    public double Area() => 3.14159 * _r * _r;
}

// ===== Exercise 4 ==========================================================
public interface IAudited { DateOnly Created { get; } }
public sealed class Invoice : IAudited
{
    public DateOnly Created { get; init; }
    public decimal Amount { get; init; }
}

public static class Ledger
{
    // Constrained so the body can read Created and compare amounts generically.
    public static (T Oldest, TAmount Total) Summarise<T, TAmount>(
        IReadOnlyList<T> items, Func<T, TAmount> amount)
        where T : class, IAudited
        where TAmount : INumber<TAmount>
    {
        if (items.Count == 0) throw new ArgumentException("no items", nameof(items));
        T oldest = items[0];
        TAmount total = TAmount.Zero;
        foreach (var item in items)
        {
            if (item.Created < oldest.Created) oldest = item;
            total += amount(item);
        }
        return (oldest, total);
    }
}

class Program
{
    const int N = 2_000_000;
    const int M = 10_000_000;

    static T ViaNew<T>() where T : new() => new T();
    static T ViaActivator<T>() => (T)Activator.CreateInstance(typeof(T))!;
    static T ViaFactory<T>(Func<T> f) => f();

    static double Boxed(IArea a) { double t = 0; for (int i = 0; i < M; i++) t += a.Area(); return t; }
    static double Constrained<T>(T a) where T : struct, IArea
    { double t = 0; for (int i = 0; i < M; i++) t += a.Area(); return t; }

    static void Main()
    {
        Console.WriteLine("===== Exercise 2: three ways to make a T =====");
        Time("new() constraint", () => { double n = 0; for (int i = 0; i < N; i++) n += ViaNew<Node>().Value; return n; }, N);
        Time("Activator.CreateInstance", () => { double n = 0; for (int i = 0; i < N; i++) n += ViaActivator<Node>().Value; return n; }, N);
        Time("Func<T> factory", () => { double n = 0; for (int i = 0; i < N; i++) n += ViaFactory(() => new Node()).Value; return n; }, N);

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: struct constraint =====");
        var c = new Circle(2);
        Time("through IArea (boxed)", () => Boxed(c), M);
        Time("where T : struct, IArea", () => Constrained(c), M);

        long b = GC.GetTotalAllocatedBytes(true);
        BoxOnce(c);
        Console.WriteLine($"  one boxed call allocated       : {GC.GetTotalAllocatedBytes(true) - b} bytes");
        b = GC.GetTotalAllocatedBytes(true);
        ConstrainOnce(c);
        Console.WriteLine($"  one constrained call allocated : {GC.GetTotalAllocatedBytes(true) - b} bytes");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: two constraints, two type parameters =====");
        var invoices = new[]
        {
            new Invoice { Created = new DateOnly(2026, 3, 1), Amount = 100.50m },
            new Invoice { Created = new DateOnly(2026, 1, 15), Amount = 42.00m },
            new Invoice { Created = new DateOnly(2026, 6, 9), Amount = 7.25m }
        };
        var (oldest, total) = Ledger.Summarise(invoices, i => i.Amount);
        Console.WriteLine($"  oldest : {oldest.Created}");
        Console.WriteLine($"  total  : {total}");

        var (o2, count) = Ledger.Summarise(invoices, _ => 1);
        Console.WriteLine($"  same call with int amounts: oldest {o2.Created}, count {count}");
    }

    static double BoxOnce(IArea a) => a.Area();
    static double ConstrainOnce<T>(T a) where T : struct, IArea => a.Area();

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
        Console.WriteLine($"  {label,-28} {best,7:F1} ms   {best * 1e6 / n,5:F2} ns/op");
    }
}
