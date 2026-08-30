// 04-readonly-and-mutation.cs — a non-readonly struct in a readonly field
// forces the compiler to copy it before every member access. And a mutable
// struct in a collection is edited in a copy you then throw away.
// .NET 10.0.400, Release. Run: dotnet run 04-readonly-and-mutation.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.CompilerServices;

// Not marked readonly. The compiler cannot know Total() leaves it unchanged.
struct MutableCounter
{
    private long _a, _b, _c, _d;
    public MutableCounter(long seed) { _a = seed; _b = seed; _c = seed; _d = seed; }
    public long Total() => _a + _b + _c + _d;
    public void Bump() => _a++;
}

// Marked readonly. The compiler knows no member can change it, so no copy.
readonly struct ReadonlyCounter
{
    private readonly long _a, _b, _c, _d;
    public ReadonlyCounter(long seed) { _a = seed; _b = seed; _c = seed; _d = seed; }
    public long Total() => _a + _b + _c + _d;
}

// The same pair at 64 bytes, with inlining prevented so the copy cannot be
// optimised away. This is what a defensive copy actually costs.
struct MutableBig
{
    private long _a, _b, _c, _d, _e, _f, _g, _h;
    public MutableBig(long s) { _a = _b = _c = _d = _e = _f = _g = _h = s; }
    [MethodImpl(MethodImplOptions.NoInlining)]
    public long Total() => _a + _b + _c + _d + _e + _f + _g + _h;
}

readonly struct ReadonlyBig
{
    private readonly long _a, _b, _c, _d, _e, _f, _g, _h;
    public ReadonlyBig(long s) { _a = _b = _c = _d = _e = _f = _g = _h = s; }
    [MethodImpl(MethodImplOptions.NoInlining)]
    public long Total() => _a + _b + _c + _d + _e + _f + _g + _h;
}

sealed class Holder
{
    public readonly MutableCounter Mutable = new(1);
    public readonly ReadonlyCounter Readonly = new(1);
    public readonly MutableBig MutableBig = new(1);
    public readonly ReadonlyBig ReadonlyBig = new(1);
}

// A mutable struct that people expect to behave like an object.
struct Tally
{
    public int Count;
    public void Increment() => Count++;
}

class Program
{
    const int N = 100_000_000;
    const int M = 50_000_000;

    static long ReadMutable(Holder h) { long t = 0; for (int i = 0; i < N; i++) t += h.Mutable.Total(); return t; }
    static long ReadReadonly(Holder h) { long t = 0; for (int i = 0; i < N; i++) t += h.Readonly.Total(); return t; }
    static long ReadMutableBig(Holder h) { long t = 0; for (int i = 0; i < M; i++) t += h.MutableBig.Total(); return t; }
    static long ReadReadonlyBig(Holder h) { long t = 0; for (int i = 0; i < M; i++) t += h.ReadonlyBig.Total(); return t; }

    static void Time(string label, Func<long> body)
    {
        body();
        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            long v = body();
            sw.Stop();
            if (v == 0) throw new Exception("optimised away");
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-40} {best,7:F1} ms");
    }

    static void Main()
    {
        Console.WriteLine("--- 1. defensive copies, reading through a readonly field ---");
        var holder = new Holder();
        Time("struct NOT marked readonly", () => ReadMutable(holder));
        Time("readonly struct", () => ReadReadonly(holder));
        Console.WriteLine("  No measurable difference: the JIT inlined Total() and the copy");
        Console.WriteLine("  disappeared with it.");

        Console.WriteLine();
        Console.WriteLine("  Now 64 bytes, with inlining prevented so the copy must happen:");
        Time("64-byte struct, NOT readonly", () => ReadMutableBig(holder));
        Time("64-byte readonly struct", () => ReadReadonlyBig(holder));
        Console.WriteLine("  Same fields, same arithmetic. The first is copied to the stack");
        Console.WriteLine("  before every call, because the compiler cannot prove Total()");
        Console.WriteLine("  leaves the readonly field unchanged.");

        Console.WriteLine();
        Console.WriteLine("--- 2. a mutable struct inside a List ---");
        var list = new List<Tally> { new Tally() };
        list[0].Increment();
        Console.WriteLine($"  after list[0].Increment()  : Count = {list[0].Count}");
        Console.WriteLine("  (does not compile for a List indexer returning a copy? it does —");
        Console.WriteLine("   the indexer returns a COPY, which is incremented and discarded)");

        var arr = new Tally[1];
        arr[0].Increment();
        Console.WriteLine($"  after arr[0].Increment()   : Count = {arr[0].Count}");
        Console.WriteLine("  An ARRAY indexer gives direct access, so this one works — the");
        Console.WriteLine("  same line of code behaves differently for List and for array.");

        Console.WriteLine();
        Console.WriteLine("--- 3. the same thing in a foreach ---");
        var tallies = new List<Tally> { new Tally(), new Tally() };
        foreach (var t in tallies) { var copy = t; copy.Increment(); }
        Console.WriteLine($"  counts after foreach: {string.Join(", ", tallies.ConvertAll(x => x.Count))}");
        Console.WriteLine("  The loop variable is a copy; mutating it changes nothing.");

        Console.WriteLine();
        Console.WriteLine("--- 4. what fixes it: do not have mutable structs ---");
        var immutable = new List<int> { 0, 0 };
        for (int i = 0; i < immutable.Count; i++) immutable[i] = immutable[i] + 1;
        Console.WriteLine($"  replacing the value instead: {string.Join(", ", immutable)}");
    }
}
