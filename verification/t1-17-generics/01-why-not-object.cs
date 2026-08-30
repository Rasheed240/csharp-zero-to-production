// 01-why-not-object.cs — what generics replaced, and what that cost.
// .NET 10.0.400, Release. Run: dotnet run 01-why-not-object.cs -c Release

// CA2013 fires on the ReferenceEquals call in block 3. That call is the
// demonstration — boxing twice produces two different objects — so the rule is
// suppressed here rather than obeyed.
#:property NoWarn=CA2013

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;

class Program
{
    const int N = 5_000_000;

    static long SumArrayList(ArrayList list)
    {
        long total = 0;
        for (int i = 0; i < list.Count; i++) total += (int)list[i]!;   // unbox
        return total;
    }

    static long SumList(List<int> list)
    {
        long total = 0;
        for (int i = 0; i < list.Count; i++) total += list[i];
        return total;
    }

    static void Main()
    {
        Console.WriteLine("--- 1. the type system before generics ---");
        var untyped = new ArrayList { 1, 2, 3 };
        untyped.Add("not a number");            // compiles. Nothing stops it.
        Console.WriteLine($"  ArrayList contents: {string.Join(", ", untyped.ToArray())}");
        try
        {
            long bad = 0;
            foreach (var item in untyped) bad += (int)item;
            Console.WriteLine($"  sum = {bad}");
        }
        catch (InvalidCastException ex)
        {
            Console.WriteLine($"  summing threw {ex.GetType().Name} at run time");
        }

        var typed = new List<int> { 1, 2, 3 };
        Console.WriteLine("  List<int>.Add(\"not a number\") does not compile (CS1503)");

        Console.WriteLine();
        Console.WriteLine("--- 2. what boxing costs ---");
        var al = new ArrayList(N);
        var gl = new List<int>(N);

        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < N; i++) al.Add(i);
        long alBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

        before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < N; i++) gl.Add(i);
        long glBytes = GC.GetTotalAllocatedBytes(precise: true) - before;

        Console.WriteLine($"  ArrayList  filling {N:N0} ints allocated {alBytes:N0} bytes");
        Console.WriteLine($"  List<int>  filling {N:N0} ints allocated {glBytes:N0} bytes");
        Console.WriteLine($"  difference: {alBytes - glBytes:N0} bytes, or " +
                          $"{(double)alBytes / N:F0} bytes per boxed int");

        Console.WriteLine();
        Time("ArrayList sum (unboxing)", () => SumArrayList(al));
        Time("List<int> sum", () => SumList(gl));

        Console.WriteLine();
        Console.WriteLine("--- 3. boxing is visible in the type system ---");
        int value = 42;
        object boxed = value;
        Console.WriteLine($"  boxed.GetType()          : {boxed.GetType().Name}");
        Console.WriteLine($"  ReferenceEquals(boxed, (object)value) : " +
                          $"{ReferenceEquals(boxed, (object)value)}");
        Console.WriteLine("  Each cast to object creates a NEW heap object holding a copy.");
    }

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
        Console.WriteLine($"  {label,-28} {best,7:F1} ms   {best * 1e6 / N,5:F2} ns/element");
    }
}
