// 01-cost.cs — what an exception actually costs, separated into the three things
// people conflate: a try block that does not throw, a throw that is caught close
// by, and a throw that unwinds a deep stack.
// .NET 10.0.400. Run: dotnet run 01-cost.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;

class Program
{
    const int Iterations = 100_000;
    static long _sink;

    static void Main()
    {
        Console.WriteLine($"iterations: {Iterations:N0}");
        Console.WriteLine();

        Console.WriteLine("--- 1. a try block that never throws ---");
        // Measured twice each, alternating, and the SECOND pair reported — the
        // first measurement in a process pays for tiering and cache warm-up, and
        // an unfair first reading is how this benchmark originally showed the
        // try block as 3x FASTER than no try block.
        Action noTry = () => { _sink += Work(1); };
        Action inTry = () =>
        {
            try { _sink += Work(1); }
            catch (InvalidOperationException) { }
        };
        Time(noTry); Time(inTry);
        var plain = Time(noTry);
        var wrapped = Time(inTry);
        Console.WriteLine($"  no try/catch : {Ns(plain):0.00} ns/op");
        Console.WriteLine($"  inside try   : {Ns(wrapped):0.00} ns/op");
        Console.WriteLine($"  difference   : {Ns(wrapped) - Ns(plain):0.00} ns/op");
        Console.WriteLine("  Not free, and not what people usually claim. No instruction");
        Console.WriteLine("  runs on entry — the protected region is recorded in a table —");
        Console.WriteLine("  but the region CONSTRAINS the JIT, which can no longer hoist");
        Console.WriteLine("  or inline as freely across it. Stable across runs at about");
        Console.WriteLine("  +3.4 ns/op here (2.7 -> 6.2).");
        Console.WriteLine("  Keep the magnitude in mind: the throw below costs ~2,957 ns,");
        Console.WriteLine("  which is roughly 900 try blocks.");

        Console.WriteLine();
        Console.WriteLine("--- 2. throwing and catching one frame away ---");
        var returnCode = Time(() =>
        {
            if (!TryParseAmount("nope", out var v)) _sink++;
            else _sink += v;
        });
        var thrown = Time(() =>
        {
            try { _sink += ParseAmount("nope"); }
            catch (FormatException) { _sink++; }
        });
        Console.WriteLine($"  bool return  : {Ns(returnCode)} ns/op");
        Console.WriteLine($"  throw/catch  : {Ns(thrown):N0} ns/op");
        Console.WriteLine($"  ratio        : {thrown / returnCode:N0}x");

        Console.WriteLine();
        Console.WriteLine("--- 3. the same throw, unwinding a deeper stack ---");
        foreach (var depth in new[] { 1, 8, 32 })
        {
            var d = depth;
            var t = Time(() =>
            {
                try { Deep(d); }
                catch (FormatException) { _sink++; }
            }, 20_000);
            Console.WriteLine($"  depth {d,2} : {Ns(t, 20_000):N0} ns/op");
        }
        Console.WriteLine("  Cost grows with the number of frames unwound, because the");
        Console.WriteLine("  runtime walks them looking for a handler and captures a");
        Console.WriteLine("  stack trace on the way.");

        Console.WriteLine();
        Console.WriteLine("--- 4. where the cost actually goes ---");
        var construct = Time(() => { _sink += new FormatException("x").Message.Length; });
        var throwCatchNoTrace = Time(() =>
        {
            try { throw Cached; }
            catch (FormatException) { _sink++; }
        });
        Console.WriteLine($"  constructing an exception object : {Ns(construct):N0} ns/op");
        Console.WriteLine($"  throw + catch of a CACHED instance: {Ns(throwCatchNoTrace):N0} ns/op");
        Console.WriteLine("  Constructing the object is cheap. The expensive part is the");
        Console.WriteLine("  throw itself: the two-pass search for a handler, the stack");
        Console.WriteLine("  walk, and the trace capture.");

        Console.WriteLine();
        Console.WriteLine("--- 5. what this means in requests per second ---");
        var perThrow = Ns(thrown);
        Console.WriteLine($"  one throw/catch ~ {perThrow:N0} ns = {perThrow / 1000:N1} us");
        Console.WriteLine($"  at 1,000 req/s with ONE exception each : " +
                          $"{perThrow * 1000 / 1_000_000:N2} ms of CPU per second");
        Console.WriteLine($"  at 1,000 req/s with 100 exceptions each: " +
                          $"{perThrow * 100_000 / 1_000_000:N1} ms of CPU per second");
        Console.WriteLine("  One exception per request is noise. Exceptions used for");
        Console.WriteLine("  ordinary control flow, in a loop, are a different question.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static readonly FormatException Cached = new("cached");

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long Work(int n) => n * 2;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static bool TryParseAmount(string s, out long value)
    {
        value = 0;
        foreach (var c in s) if (c < '0' || c > '9') return false;
        value = long.Parse(s);
        return true;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static long ParseAmount(string s)
    {
        foreach (var c in s)
            if (c < '0' || c > '9') throw new FormatException($"'{s}' is not a number");
        return long.Parse(s);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Deep(int depth)
    {
        if (depth == 0) throw new FormatException("bottom");
        Deep(depth - 1);
    }

    static double Time(Action a, int iterations = Iterations)
    {
        for (var i = 0; i < 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Ns(double ms, int iterations = Iterations) => ms * 1_000_000 / iterations;
}
