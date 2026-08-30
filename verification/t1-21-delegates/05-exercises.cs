// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400, Release. Run: dotnet run 05-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;

class Holder { public int Twice(int v) => v * 2; }

class Program
{
    static readonly List<string> Log = new();

    static int A(int v) { Log.Add($"A({v})"); return v + 1; }
    static int B(int v) { Log.Add($"B({v})"); return v + 2; }
    static int C(int v) { Log.Add($"C({v})"); return v + 3; }
    static int Boom(int v) => throw new InvalidOperationException("boom");

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Work(int x) => x & 7;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: what does a multicast call return? =====");
        Func<int, int> chain = A;
        chain += B;
        chain += C;
        Log.Clear();
        int result = chain(10);
        Console.WriteLine($"  invocation list length : {chain.GetInvocationList().Length}");
        Console.WriteLine($"  methods that ran       : {string.Join(", ", Log)}");
        Console.WriteLine($"  returned value         : {result}");
        var every = chain.GetInvocationList().Cast<Func<int, int>>().Select(f => f(10)).ToArray();
        Console.WriteLine($"  every result           : {string.Join(", ", every)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: equality and removal =====");
        Func<int, int> s1 = A, s2 = A;
        var h = new Holder();
        Func<int, int> i1 = h.Twice, i2 = h.Twice;
        Func<int, int> l1 = v => v * 2, l2 = v => v * 2;
        Console.WriteLine($"  static group    : == {s1 == s2,-5} ReferenceEquals {ReferenceEquals(s1, s2)}");
        Console.WriteLine($"  instance, same  : == {i1 == i2,-5} ReferenceEquals {ReferenceEquals(i1, i2)}");
        Console.WriteLine($"  two lambdas     : == {l1 == l2,-5} ReferenceEquals {ReferenceEquals(l1, l2)}");

        Func<int, int>? removeByText = A;
        removeByText += v => v * 2;
        removeByText -= v => v * 2;
        Console.WriteLine($"  -= a fresh lambda -> entries: {removeByText!.GetInvocationList().Length}");

        Func<int, int> kept = v => v * 2;
        Func<int, int>? removeByRef = A;
        removeByRef += kept;
        removeByRef -= kept;
        Console.WriteLine($"  -= the kept reference -> entries: {removeByRef!.GetInvocationList().Length}");

        Func<int, int>? emptied = A;
        emptied -= A;
        Console.WriteLine($"  removing the last entry -> null? {emptied is null}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: an exception mid-chain =====");
        Func<int, int> fragile = A;
        fragile += Boom;
        fragile += C;
        Log.Clear();
        try { fragile(10); }
        catch (InvalidOperationException) { }
        Console.WriteLine($"  methods that ran : {string.Join(", ", Log)}");
        Console.WriteLine($"  C ran?           : {Log.Any(x => x.StartsWith("C"))}");

        Log.Clear();
        var failures = new List<string>();
        foreach (var f in fragile.GetInvocationList().Cast<Func<int, int>>())
        {
            try { f(10); }
            catch (Exception ex) { failures.Add(ex.GetType().Name); }
        }
        Console.WriteLine($"  isolating each   : ran {string.Join(", ", Log)}; " +
                          $"failures {string.Join(", ", failures)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: allocation =====");
        Measure("non-capturing lambda", () => Take(x => x & 7));
        Measure("static method group", () => Take(Work));
        int fixedValue = 7;
        Measure("lambda capturing an unchanging local", () => Take(x => x & fixedValue));
        MeasureVarying("lambda capturing a changing local");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4b: invocation cost =====");
        Time("direct call (not inlined)", () => { long s = 0; for (int i = 0; i < 20_000_000; i++) s += Work(i); return s; }, 20_000_000);
        Func<int, int> viaDelegate = Work;
        Time("through a delegate", () => { long s = 0; for (int i = 0; i < 20_000_000; i++) s += viaDelegate(i); return s; }, 20_000_000);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Take(Func<int, int> f) => f(1);

    static void Measure(string label, Action body)
    {
        for (int i = 0; i < 100; i++) body();
        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < 1000; i++) body();
        long bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"  {label,-40} {bytes,8:N0} bytes per 1,000");
    }

    static void MeasureVarying(string label)
    {
        for (int i = 0; i < 100; i++) { int c = i; Take(x => x & c); }
        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < 1000; i++) { int c = i; Take(x => x & c); }
        long bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"  {label,-40} {bytes,8:N0} bytes per 1,000");
    }

    static void Time(string label, Func<long> body, int n)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception();
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} {best,7:F1} ms   {best * 1e6 / n,5:F2} ns/call");
    }
}
