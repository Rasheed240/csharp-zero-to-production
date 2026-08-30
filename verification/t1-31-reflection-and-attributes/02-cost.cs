// 02-cost.cs — what reflection costs, separated into discovery (once) and
// invocation (every time), and what each of the four escape hatches buys back.
// .NET 10.0.400. Run: dotnet run 02-cost.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075;IL3050
// File-based apps default to PublishAot=true, which turns OFF runtime code
// generation — Expression.Compile() then falls back to an interpreter and is
// SLOWER than reflection. Turning it off here measures the ordinary JIT case;
// 04-trimming-and-aot.cs measures the other one deliberately.
#:property PublishAot=false

using System;
using System.Diagnostics;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.CompilerServices;

public sealed class Invoice
{
    public string Number { get; set; } = "INV-1";
    public long AmountMinor { get; set; } = 120_00;

    [MethodImpl(MethodImplOptions.NoInlining)]
    public long WithVat() => AmountMinor * 12 / 10;
}

class Program
{
    const int Iterations = 1_000_000;
    static long _sink;

    static void Main()
    {
        var invoice = new Invoice();
        Console.WriteLine($"RuntimeFeature.IsDynamicCodeCompiled : " +
                          $"{System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeCompiled}");
        Console.WriteLine();

        Console.WriteLine("=== DISCOVERY: the one-off cost of finding metadata ===");
        Console.WriteLine();
        var lookup = Time(() => { _sink += typeof(Invoice).GetProperty("Number") is null ? 0 : 1; }, 200_000);
        var typeofOnly = Time(() => { _sink += typeof(Invoice).IsSealed ? 1 : 0; }, 200_000);
        var byName = Time(() => { _sink += Type.GetType("Invoice") is null ? 0 : 1; }, 200_000);
        Console.WriteLine($"  typeof(T).IsSealed          : {Ns(typeofOnly, 200_000):N1} ns/op");
        Console.WriteLine($"  GetProperty(\"Number\")       : {Ns(lookup, 200_000):N1} ns/op");
        Console.WriteLine($"  Type.GetType(\"Invoice\")     : {Ns(byName, 200_000):N1} ns/op");
        Console.WriteLine("  Member lookup is a string comparison against a metadata table.");
        Console.WriteLine("  It is not free, and it is the part you can cache.");

        Console.WriteLine();
        Console.WriteLine("=== INVOCATION: the per-call cost, five ways ===");
        Console.WriteLine();

        var prop = typeof(Invoice).GetProperty(nameof(Invoice.AmountMinor))!;
        var method = typeof(Invoice).GetMethod(nameof(Invoice.WithVat))!;

        // 1. Direct.
        var direct = Time(() => { _sink += invoice.WithVat(); });

        // 2. MethodInfo.Invoke, with the MethodInfo already cached.
        var invoke = Time(() => { _sink += (long)method.Invoke(invoice, null)!; }, 200_000);

        // 3. PropertyInfo.GetValue, cached.
        var getValue = Time(() => { _sink += (long)prop.GetValue(invoice)!; }, 200_000);

        // 4. A delegate created once from the MethodInfo.
        var asDelegate = method.CreateDelegate<Func<Invoice, long>>();
        var viaDelegate = Time(() => { _sink += asDelegate(invoice); });

        // 5. A compiled expression tree, built once.
        var param = Expression.Parameter(typeof(Invoice), "i");
        var compiled = Expression.Lambda<Func<Invoice, long>>(
            Expression.Property(param, prop), param).Compile();
        var viaExpression = Time(() => { _sink += compiled(invoice); });

        // 6. The property, read directly, for the getter comparison.
        var directProp = Time(() => { _sink += invoice.AmountMinor; });

        var d = Ns(direct);
        Console.WriteLine($"  direct method call             : {d,10:N1} ns/op   1.0x");
        Console.WriteLine($"  MethodInfo.Invoke (cached MI)  : {Ns(invoke, 200_000),10:N1} ns/op   " +
                          $"{Ns(invoke, 200_000) / d,6:N0}x");
        Console.WriteLine($"  delegate from CreateDelegate   : {Ns(viaDelegate),10:N1} ns/op   " +
                          $"{Ns(viaDelegate) / d,6:N1}x");
        Console.WriteLine();
        var dp = Ns(directProp);
        Console.WriteLine($"  direct property read           : {dp,10:N1} ns/op   1.0x");
        Console.WriteLine($"  PropertyInfo.GetValue (cached) : {Ns(getValue, 200_000),10:N1} ns/op   " +
                          $"{Ns(getValue, 200_000) / dp,6:N0}x");
        Console.WriteLine($"  compiled expression tree       : {Ns(viaExpression),10:N1} ns/op   " +
                          $"{Ns(viaExpression) / dp,6:N1}x");

        Console.WriteLine();
        Console.WriteLine("=== ALLOCATION per call ===");
        Console.WriteLine();
        Console.WriteLine($"  direct method call             : {AllocOf(() => _sink += invoice.WithVat()),6} bytes");
        Console.WriteLine($"  MethodInfo.Invoke              : {AllocOf(() => _sink += (long)method.Invoke(invoice, null)!),6} bytes");
        Console.WriteLine($"  PropertyInfo.GetValue          : {AllocOf(() => _sink += (long)prop.GetValue(invoice)!),6} bytes");
        Console.WriteLine($"  delegate                       : {AllocOf(() => _sink += asDelegate(invoice)),6} bytes");
        Console.WriteLine($"  compiled expression            : {AllocOf(() => _sink += compiled(invoice)),6} bytes");
        Console.WriteLine("  Invoke boxes the return value and, when there are arguments,");
        Console.WriteLine("  allocates the object[] as well. The delegate and the compiled");
        Console.WriteLine("  expression are ordinary typed calls once built.");

        Console.WriteLine();
        Console.WriteLine("=== BUILD COST of the two escape hatches ===");
        Console.WriteLine();
        var makeDelegate = Time(() => { _sink += method.CreateDelegate<Func<Invoice, long>>() is null ? 0 : 1; }, 20_000);
        var makeExpression = Time(() =>
        {
            var p2 = Expression.Parameter(typeof(Invoice), "i");
            var f = Expression.Lambda<Func<Invoice, long>>(Expression.Property(p2, prop), p2).Compile();
            _sink += f is null ? 0 : 1;
        }, 2_000);
        Console.WriteLine($"  CreateDelegate           : {Ns(makeDelegate, 20_000):N0} ns, once");
        Console.WriteLine($"  Expression .Compile()    : {Ns(makeExpression, 2_000):N0} ns, once");
        Console.WriteLine("  Compiling an expression tree costs microseconds and pays for");
        Console.WriteLine("  itself after a few thousand calls. Building it per call is the");
        Console.WriteLine("  mistake — it is more expensive than Invoke.");

        Console.WriteLine();
        Console.WriteLine($"  break-even for Compile vs GetValue : " +
                          $"~{Ns(makeExpression, 2_000) / Math.Max(Ns(getValue, 200_000) - Ns(viaExpression), 1):N0} calls");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static double Time(Action a, int iterations = Iterations)
    {
        for (var i = 0; i < Math.Min(iterations, 1_000); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Ns(double ms, int iterations = Iterations) => ms * 1_000_000 / iterations;

    static long AllocOf(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        a();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }
}
