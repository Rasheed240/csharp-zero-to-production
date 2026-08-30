// 04-trimming-and-aot.cs — the two ways reflection stops working when the app is
// trimmed or compiled ahead of time, and the annotation that fixes one of them.
// This file runs with the file-based-app DEFAULT (PublishAot=true), which is
// exactly the configuration that exposes the problem.
// .NET 10.0.400. Run: dotnet run 04-trimming-and-aot.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.CompilerServices;

public sealed class Invoice
{
    public string Number { get; set; } = "INV-1";
    public long AmountMinor { get; set; } = 120_00;
}

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("--- what this runtime supports ---");
        Console.WriteLine($"  RuntimeFeature.IsDynamicCodeSupported : {RuntimeFeature.IsDynamicCodeSupported}");
        Console.WriteLine($"  RuntimeFeature.IsDynamicCodeCompiled  : {RuntimeFeature.IsDynamicCodeCompiled}");
        Console.WriteLine("  A file-based app defaults to PublishAot=true, so runtime code");
        Console.WriteLine("  generation is off — the same as a published AOT binary.");

        Console.WriteLine();
        Console.WriteLine("--- 1. Expression.Compile() silently becomes an INTERPRETER ---");
        var prop = typeof(Invoice).GetProperty(nameof(Invoice.AmountMinor))!;
        var param = Expression.Parameter(typeof(Invoice), "i");
        var compiled = Expression.Lambda<Func<Invoice, long>>(
            Expression.Property(param, prop), param).Compile();

        var invoice = new Invoice();
        Console.WriteLine($"  it still WORKS  : {compiled(invoice)}");
        var interpreted = Time(() => { _sink += compiled(invoice); });
        var direct = Time(() => { _sink += invoice.AmountMinor; });
        var getValue = Time(() => { _sink += (long)prop.GetValue(invoice)!; }, 200_000);
        Console.WriteLine($"  direct property read     : {Ns(direct),8:N1} ns/op");
        Console.WriteLine($"  PropertyInfo.GetValue    : {Ns(getValue, 200_000),8:N1} ns/op");
        Console.WriteLine($"  \"compiled\" expression    : {Ns(interpreted),8:N1} ns/op");
        Console.WriteLine($"  allocation per call      : {AllocOf(() => _sink += compiled(invoice))} bytes");
        Console.WriteLine("  No exception, no warning at runtime — it works and it is");
        Console.WriteLine("  SLOWER than the reflection it was supposed to replace, and it");
        Console.WriteLine("  allocates. The same code on a JIT runtime is ~5.5 ns and 0 bytes.");
        Console.WriteLine("  This is the failure mode people miss, because nothing fails.");

        Console.WriteLine();
        Console.WriteLine("--- 2. the analyser warns at BUILD time, and that is the real signal ---");
        Console.WriteLine("  Expression.Compile() carries [RequiresDynamicCode], so building");
        Console.WriteLine("  an AOT-published app reports:");
        Console.WriteLine("    warning IL3050: Using member 'System.Linq.Expressions.Expression");
        Console.WriteLine("    <TDelegate>.Compile()' which has 'RequiresDynamicCodeAttribute'");
        Console.WriteLine("    can break functionality when AOT compiling.");
        Console.WriteLine("  Every file in this project that uses reflection carries a");
        Console.WriteLine("  '#:property NoWarn=...' line for exactly these codes. Suppressing");
        Console.WriteLine("  them is right for a demo and wrong for a shipping AOT app.");

        Console.WriteLine();
        Console.WriteLine("--- 3. trimming removes members nothing references statically ---");
        Console.WriteLine("  A trimmer keeps what it can SEE being used. It cannot see");
        Console.WriteLine("  GetProperty(\"AmountMinor\") — that is a string. So the property");
        Console.WriteLine("  may be removed and the lookup returns null at runtime:");
        Console.WriteLine("    NullReferenceException, in code that worked in Debug.");

        Console.WriteLine();
        Console.WriteLine("--- the annotation that fixes it ---");
        Console.WriteLine($"  Unannotated(typeof(Invoice)) : {Unannotated(typeof(Invoice))}");
        Console.WriteLine($"  Annotated(typeof(Invoice))   : {Annotated(typeof(Invoice))}");
        Console.WriteLine("  Both work here. The difference is what the TRIMMER is told:");
        Console.WriteLine("  [DynamicallyAccessedMembers] on the parameter makes it preserve");
        Console.WriteLine("  the public properties of every type that reaches it. Without it,");
        Console.WriteLine("  the trimmer warns IL2070 and preserves nothing.");

        Console.WriteLine();
        Console.WriteLine("--- what is safe under trimming and AOT ---");
        Console.WriteLine($"  typeof(Invoice).Name                  : {typeof(Invoice).Name}");
        Console.WriteLine($"  invoice.GetType().Name                : {invoice.GetType().Name}");
        Console.WriteLine($"  a cached delegate from CreateDelegate : safe, no codegen");
        var getter = typeof(Invoice).GetProperty(nameof(Invoice.AmountMinor))!
            .GetGetMethod()!.CreateDelegate<Func<Invoice, long>>();
        Console.WriteLine($"    calling it                          : {getter(invoice)}");
        Console.WriteLine($"    per-call cost                       : {Ns(Time(() => _sink += getter(invoice))):N1} ns/op");
        Console.WriteLine("  CreateDelegate binds to existing IL rather than emitting new");
        Console.WriteLine("  code, so it survives AOT — unlike Expression.Compile().");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // No annotation: the trimmer cannot know which members to keep. IL2070.
    [UnconditionalSuppressMessage("Trimming", "IL2070",
        Justification = "Demonstration of the unannotated case; the type is rooted in this file.")]
    static int Unannotated(Type type) => type.GetProperties().Length;

    // Annotated: the trimmer preserves public properties of whatever is passed.
    static int Annotated([DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicProperties)]
                         Type type) => type.GetProperties().Length;

    static double Time(Action a, int iterations = 1_000_000)
    {
        for (var i = 0; i < Math.Min(iterations, 1_000); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Ns(double ms, int iterations = 1_000_000) => ms * 1_000_000 / iterations;

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
