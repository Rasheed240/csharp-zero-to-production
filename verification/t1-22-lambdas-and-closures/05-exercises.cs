// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400, Release. Run: dotnet run 05-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

class Program
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Use(Func<int, int> f) => f(1);

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int UseState(Func<int, int, int> f, int s) => f(1, s);

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: for vs foreach =====");
        var a = new List<Func<int>>();
        for (int i = 0; i < 3; i++) a.Add(() => i);
        Console.WriteLine($"  for      : {string.Join(", ", a.ConvertAll(f => f()))}");

        var b = new List<Func<int>>();
        foreach (var i in new[] { 0, 1, 2 }) b.Add(() => i);
        Console.WriteLine($"  foreach  : {string.Join(", ", b.ConvertAll(f => f()))}");

        var c = new List<Func<int>>();
        for (int i = 0; i < 3; i++) { int copy = i; c.Add(() => copy); }
        Console.WriteLine($"  for+copy : {string.Join(", ", c.ConvertAll(f => f()))}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: capture is by variable =====");
        int counter = 0;
        Func<int> read = () => counter;
        Action bump = () => counter++;
        Console.WriteLine($"  read() at start      : {read()}");
        counter = 10;
        Console.WriteLine($"  after counter = 10   : {read()}");
        bump();
        Console.WriteLine($"  after bump()         : read()={read()}, counter={counter}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: allocation by shape =====");
        Report("captures nothing", () => Use(x => x & 7));
        int outer = 7;
        Report("captures a local from an outer scope", () => Use(x => x & outer));
        Report("captures a local from the inner scope", () =>
        { int inner = Environment.TickCount; Use(x => x & inner); });
        Report("captures two locals from one scope", () =>
        { int p = Environment.TickCount, q = p + 1; Use(x => (x & p) + q); });
        Report("static lambda taking state as an argument", () =>
        { int s = Environment.TickCount; UseState(static (x, st) => x & st, s); });

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: capturing this =====");
        var h = new Cache(5);
        var byField = h.ByField();
        var byLocal = h.ByLocal();
        Console.WriteLine($"  lambda using a field : Target={byField.Target?.GetType().Name}");
        Console.WriteLine($"  lambda using a local : Target={byLocal.Target?.GetType().Name}");

        var w1 = Make(out var keep1, useField: true);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        Console.WriteLine($"  field version: Cache still alive after GC : {w1.IsAlive}");
        GC.KeepAlive(keep1);

        var w2 = Make(out var keep2, useField: false);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        Console.WriteLine($"  local version: Cache still alive after GC : {w2.IsAlive}");
        GC.KeepAlive(keep2);
    }

    static WeakReference Make(out Func<int, int> kept, bool useField)
    {
        var cache = new Cache(1);
        kept = useField ? cache.ByField() : cache.ByLocal();
        return new WeakReference(cache);
    }

    static void Report(string label, Action body)
    {
        for (int i = 0; i < 200; i++) body();
        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < 1000; i++) body();
        Console.WriteLine($"  {label,-44} {GC.GetTotalAllocatedBytes(precise: true) - before,8:N0} bytes / 1,000");
    }
}

sealed class Cache
{
    private readonly int _size;
    private readonly byte[] _buffer = new byte[50_000];
    public Cache(int size) => _size = size;
    public Func<int, int> ByField() => x => x + _size;
    public Func<int, int> ByLocal() { int s = _size; return x => x + s; }
}
