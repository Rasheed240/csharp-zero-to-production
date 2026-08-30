// 02-dispatch-cost.cs — what each kind of call costs.
//
// METHOD NOTE. .NET uses dynamic profile-guided optimisation: the JIT watches
// which type actually arrives at a call site and emits a fast path guarded by a
// type check. That makes measurement delicate — two scenarios sharing one loop
// method share one call site and therefore one profile, and the second scenario
// then measures guard failures rather than itself. Every scenario below has its
// own loop method for that reason, and the polymorphic case is run in a
// separate process (pass "poly") so no earlier measurement has warmed it.
//
// .NET 10.0.400, Release, x64.
//   dotnet run 02-dispatch-cost.cs -c Release
//   dotnet run 02-dispatch-cost.cs -c Release -- poly

using System;
using System.Diagnostics;

interface IScorer { int Score(int x); }

class Base : IScorer
{
    public int Direct(int x) => x & 7;
    public virtual int Virtual(int x) => x & 7;
    public virtual int Score(int x) => x & 7;
}

class A : Base { public override int Virtual(int x) => x & 7; public override int Score(int x) => x & 7; }
class B : Base { public override int Virtual(int x) => x & 7; public override int Score(int x) => x & 7; }
class C : Base { public override int Virtual(int x) => x & 7; public override int Score(int x) => x & 7; }
class D : Base { public override int Virtual(int x) => x & 7; public override int Score(int x) => x & 7; }

sealed class SealedLeaf : Base
{
    public override int Virtual(int x) => x & 7;
    public override int Score(int x) => x & 7;
}

abstract class Shape { public abstract int Area(int x); }
sealed class Sq : Shape { public override int Area(int x) => x & 7; }

class Program
{
    const int N = 100_000_000;

    // Each of these is a separate call site with its own type profile.
    static long L1(Base b) { long s = 0; for (int i = 0; i < N; i++) s += b.Direct(i); return s; }
    static long L2(Base b) { long s = 0; for (int i = 0; i < N; i++) s += b.Virtual(i); return s; }
    static long L3(SealedLeaf b) { long s = 0; for (int i = 0; i < N; i++) s += b.Virtual(i); return s; }
    static long L4(IScorer b) { long s = 0; for (int i = 0; i < N; i++) s += b.Score(i); return s; }
    static long L5(Shape b) { long s = 0; for (int i = 0; i < N; i++) s += b.Area(i); return s; }
    static long L6(Base[] bs) { long s = 0; for (int i = 0; i < N; i++) s += bs[i & 3].Virtual(i); return s; }
    static long L7(Base[] bs) { long s = 0; for (int i = 0; i < N; i++) s += bs[0].Virtual(i); return s; }
    static long L8(IScorer[] bs) { long s = 0; for (int i = 0; i < N; i++) s += bs[i & 3].Score(i); return s; }

    static void Time(string label, Func<long> body)
    {
        body();
        double best = double.MaxValue, worst = 0;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long s = body();
            sw.Stop();
            if (s == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
            worst = Math.Max(worst, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} best {best,7:F1} ms   worst {worst,7:F1} ms");
    }

    static void Main(string[] args)
    {
        bool poly = args.Length > 0 && args[0] == "poly";
        Console.WriteLine($"N = {N:N0} calls per run, best and worst of 5, mode = {(poly ? "polymorphic" : "monomorphic")}");
        Console.WriteLine();

        if (!poly)
        {
            Console.WriteLine("One implementing type reaches each call site:");
            Time("non-virtual call", () => L1(new A()));
            Time("virtual", () => L2(new A()));
            Time("virtual, receiver typed as sealed class", () => L3(new SealedLeaf()));
            Time("interface call", () => L4(new A()));
            Time("abstract call, sealed implementation", () => L5(new Sq()));
            Console.WriteLine();
            Console.WriteLine("Run again with \"poly\" for the multi-type case.");
        }
        else
        {
            Base[] four = { new A(), new B(), new C(), new D() };
            IScorer[] fourI = { new A(), new B(), new C(), new D() };
            Base[] one = { new A(), new A(), new A(), new A() };

            Console.WriteLine("Four different types reach the same call site:");
            Time("virtual, 4 types alternating", () => L6(four));
            Time("interface, 4 types alternating", () => L8(fourI));
            Console.WriteLine();
            Console.WriteLine("Same loop shape, but every element is the same type:");
            Time("virtual, array of one type", () => L7(one));
        }
    }
}
