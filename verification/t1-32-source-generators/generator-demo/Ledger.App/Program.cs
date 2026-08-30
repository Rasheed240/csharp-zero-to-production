// Program.cs — the consumer. Nothing here calls the generator; the compiler runs
// it and the generated members are ordinary members of these classes.

using System.Diagnostics;
using System.Reflection;

namespace Ledger.App;

// [AuditLog] comes from the generator itself, via RegisterPostInitializationOutput.
// 'partial' is what lets the generated half join this one.
[AuditLog]
public partial class Invoice
{
    public string Number { get; set; } = "INV-1";
    public string CustomerId { get; set; } = "CUST-1";
    public long AmountMinor { get; set; } = 120_00;
    private string Secret { get; set; } = "hidden";      // not public: not logged
}

[AuditLog]
public partial class Payment
{
    public string Reference { get; set; } = "P-1";
    public long AmountMinor { get; set; } = 5_000;
}

// No attribute: no generated member. Proof that generation is opt-in.
public partial class Refund
{
    public string Reference { get; set; } = "R-1";
}

public static class Program
{
    public static void Main()
    {
        var invoice = new Invoice();
        var payment = new Payment();

        Console.WriteLine("--- generated members, called like any other ---");
        Console.WriteLine($"  {invoice.ToAuditLog()}");
        Console.WriteLine($"  {payment.ToAuditLog()}");
        Console.WriteLine("  ToAuditLog() was written by the generator at build time.");
        Console.WriteLine("  IntelliSense sees it, Go to Definition opens the generated");
        Console.WriteLine("  file, and a typo in it is a compile error like any other.");

        Console.WriteLine();
        Console.WriteLine("--- the private property is absent, by design ---");
        Console.WriteLine($"  Invoice has a private Secret : " +
                          $"{typeof(Invoice).GetProperty("Secret", BindingFlags.NonPublic | BindingFlags.Instance) is not null}");
        Console.WriteLine($"  it appears in the audit log  : {invoice.ToAuditLog().Contains("Secret")}");

        Console.WriteLine();
        Console.WriteLine("--- Refund has no [AuditLog], so it has no ToAuditLog ---");
        Console.WriteLine($"  method exists : {typeof(Refund).GetMethod("ToAuditLog") is not null}");

        Console.WriteLine();
        Console.WriteLine("--- the generated method is a NORMAL method in metadata ---");
        var method = typeof(Invoice).GetMethod(nameof(Invoice.ToAuditLog))!;
        Console.WriteLine($"  DeclaringType : {method.DeclaringType!.Name}");
        Console.WriteLine($"  IsStatic      : {method.IsStatic}");
        Console.WriteLine($"  ReturnType    : {method.ReturnType.Name}");
        Console.WriteLine("  There is no marker distinguishing it from hand-written code.");
        Console.WriteLine("  The trimmer sees a real method being called and keeps it.");

        Console.WriteLine();
        Console.WriteLine("--- cost, against the reflective equivalent ---");
        var generated = Time(() => _sink += invoice.ToAuditLog().Length);
        var reflective = Time(() => _sink += ReflectiveAuditLog(invoice).Length, 200_000);
        Console.WriteLine($"  generated  : {generated,8:N0} ns/op");
        Console.WriteLine($"  reflective : {reflective,8:N0} ns/op");
        Console.WriteLine($"  ratio      : {reflective / generated,8:N1}x");
        Console.WriteLine($"  same text  : {invoice.ToAuditLog() == ReflectiveAuditLog(invoice)}");

        Console.WriteLine();
        Console.WriteLine($"  allocation, generated  : {AllocOf(() => _sink += invoice.ToAuditLog().Length),5} bytes");
        Console.WriteLine($"  allocation, reflective : {AllocOf(() => _sink += ReflectiveAuditLog(invoice).Length),5} bytes");
        Console.WriteLine("  No PropertyInfo lookups, no boxing, no cache to maintain.");
        Console.WriteLine("  The generator did the discovery once, at build time, for free.");

        Console.WriteLine();
        Console.WriteLine("--- where the generated source went ---");
        Console.WriteLine("  EmitCompilerGeneratedFiles=true writes it under:");
        Console.WriteLine("    Ledger.App/generated/Ledger.Generators/");
        Console.WriteLine("      Ledger.Generators.AuditLogGenerator/");
        Console.WriteLine("  Those files are build OUTPUT: readable, debuggable, and");
        Console.WriteLine("  regenerated on every build. Editing them achieves nothing.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    private static long _sink;

    /// <summary>The runtime equivalent, for comparison. Uncached, as a first attempt would be.</summary>
    private static string ReflectiveAuditLog(object instance)
    {
        var sb = new System.Text.StringBuilder();
        var type = instance.GetType();
        sb.Append(type.Name).Append(" { ");
        var first = true;
        foreach (var p in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                              .OrderBy(p => p.Name, StringComparer.Ordinal))
        {
            if (!first) sb.Append(", ");
            first = false;
            sb.Append(p.Name).Append('=').Append(p.GetValue(instance));
        }
        return sb.Append(" }").ToString();
    }

    private static double Time(Action a, int iterations = 1_000_000)
    {
        for (var i = 0; i < Math.Min(iterations, 1_000); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / iterations;
    }

    private static long AllocOf(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        a();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }
}
