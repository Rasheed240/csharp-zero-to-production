// 03-cost.cs — what composition costs at run time: one extra indirection per
// wrapper layer.
//
// METHOD NOTE. Following the lesson from t1-11: each scenario gets its OWN loop
// method so scenarios do not share a dynamic-PGO type profile, and there is a
// control that does the same work with no wrapper at all.
//
// .NET 10.0.400, Release, x64. Run: dotnet run 03-cost.cs -c Release

using System;
using System.Diagnostics;

interface IStep { int Apply(int x); }

sealed class Core : IStep { public int Apply(int x) => x & 7; }

sealed class Wrapper : IStep
{
    private readonly IStep _inner;
    public Wrapper(IStep inner) => _inner = inner;
    public int Apply(int x) => _inner.Apply(x);
}

// The inheritance equivalent: one class, one virtual call.
class BaseStep { public virtual int Apply(int x) => x & 7; }
sealed class DerivedStep : BaseStep { public override int Apply(int x) => base.Apply(x); }

class Program
{
    const int N = 50_000_000;

    static long L0(int seed) { long s = 0; for (int i = 0; i < N; i++) s += (i & 7); return s; }
    static long L1(IStep st) { long s = 0; for (int i = 0; i < N; i++) s += st.Apply(i); return s; }
    static long L2(IStep st) { long s = 0; for (int i = 0; i < N; i++) s += st.Apply(i); return s; }
    static long L3(IStep st) { long s = 0; for (int i = 0; i < N; i++) s += st.Apply(i); return s; }
    static long L4(IStep st) { long s = 0; for (int i = 0; i < N; i++) s += st.Apply(i); return s; }
    static long L5(BaseStep st) { long s = 0; for (int i = 0; i < N; i++) s += st.Apply(i); return s; }

    static IStep Nest(int layers)
    {
        IStep s = new Core();
        for (int i = 0; i < layers; i++) s = new Wrapper(s);
        return s;
    }

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
        Console.WriteLine($"  {label,-34} best {best,7:F1} ms   worst {worst,7:F1} ms   " +
                          $"{best * 1e6 / N,5:F2} ns/call");
    }

    static void Main()
    {
        Console.WriteLine($"N = {N:N0} calls per run, best and worst of 5");
        Console.WriteLine();
        Time("no call at all (control)", () => L0(0));
        Time("inheritance: 1 virtual call", () => L5(new DerivedStep()));
        Time("composition: 0 wrappers", () => L1(Nest(0)));
        Time("composition: 1 wrapper", () => L2(Nest(1)));
        Time("composition: 3 wrappers", () => L3(Nest(3)));
        Time("composition: 8 wrappers", () => L4(Nest(8)));
    }
}
