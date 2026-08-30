// 03-invocation-cost.cs — what calling through a delegate costs, against the
// alternatives, and what a multicast list costs per entry.
//
// METHOD NOTE, following t1-11: each scenario has its OWN loop method so they
// do not share a dynamic-PGO type profile, and there is a direct-call control.
//
// .NET 10.0.400, Release. Run: dotnet run 03-invocation-cost.cs -c Release

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;

interface IStep { int Apply(int x); }
sealed class Step : IStep
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public int Apply(int x) => x & 7;
}

class Base
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public virtual int Apply(int x) => x & 7;
}
sealed class Derived : Base
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public override int Apply(int x) => x & 7;
}

class Program
{
    const int N = 50_000_000;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Direct(int x) => x & 7;

    static long L1() { long s = 0; for (int i = 0; i < N; i++) s += Direct(i); return s; }
    static long L2(Func<int, int> f) { long s = 0; for (int i = 0; i < N; i++) s += f(i); return s; }
    static long L3(Func<int, int> f) { long s = 0; for (int i = 0; i < N; i++) s += f(i); return s; }
    static long L4(IStep st) { long s = 0; for (int i = 0; i < N; i++) s += st.Apply(i); return s; }
    static long L5(Base b) { long s = 0; for (int i = 0; i < N; i++) s += b.Apply(i); return s; }
    static long L6(Func<int, int> f) { long s = 0; for (int i = 0; i < N / 4; i++) s += f(i); return s; }
    static long L7(Func<int, int> f) { long s = 0; for (int i = 0; i < N / 4; i++) s += f(i); return s; }

    static void Time(string label, Func<long> body, int n)
    {
        body();
        double best = double.MaxValue, worst = 0;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
            worst = Math.Max(worst, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-38} best {best,7:F1} ms   {best * 1e6 / n,5:F2} ns/call");
    }

    static void Main()
    {
        Console.WriteLine($"N = {N:N0} calls, best of 5");
        Console.WriteLine();

        Time("direct static call (not inlined)", L1, N);
        Time("delegate to a static method", () => L2(Direct), N);
        Time("delegate to a lambda calling the same method", () => L3(x => Direct(x)), N);
        Time("interface call", () => L4(new Step()), N);
        Time("virtual call", () => L5(new Derived()), N);

        Console.WriteLine();
        Console.WriteLine($"--- multicast, {N / 4:N0} invocations of the whole chain ---");
        Func<int, int> one = Direct;
        Func<int, int> three = Direct;
        three += Direct;
        three += Direct;

        Time("1 entry in the invocation list", () => L6(one), N / 4);
        Time("3 entries in the invocation list", () => L7(three), N / 4);
        Console.WriteLine($"  (the 3-entry chain calls the method {3} times per invocation,");
        Console.WriteLine("   so divide by 3 to compare per-call cost)");

        Console.WriteLine();
        Console.WriteLine("--- allocation: does taking a delegate allocate? ---");
        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < 1000; i++) TakeNonCapturing(x => x & 7);
        long nonCapturing = GC.GetTotalAllocatedBytes(precise: true) - before;

        before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < 1000; i++)
        {
            int captured = i;                       // DIFFERENT each iteration
            TakeNonCapturing(x => x & captured);
        }
        long capturing = GC.GetTotalAllocatedBytes(precise: true) - before;

        before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < 1000; i++) TakeNonCapturing(Direct);
        long methodGroup = GC.GetTotalAllocatedBytes(precise: true) - before;

        Console.WriteLine($"  1000 non-capturing lambdas : {nonCapturing,7:N0} bytes");
        Console.WriteLine($"  1000 capturing lambdas     : {capturing,7:N0} bytes");
        Console.WriteLine($"  1000 static method groups  : {methodGroup,7:N0} bytes");
        Console.WriteLine("  The compiler caches a lambda that captures nothing, and caches a");
        Console.WriteLine("  static method group conversion. Capturing is the case that costs,");
        Console.WriteLine("  and it gets a module of its own next.");
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int TakeNonCapturing(Func<int, int> f) => f(1);
}
