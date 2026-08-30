// 01-static-basics.cs — what "static" attaches a member to, and the four
// storage choices for a value that does not change per instance.
// .NET 10.0.400. Run: dotnet run 01-static-basics.cs

using System;
using System.Linq;
using System.Reflection;

class Counter
{
    // One slot for the whole type, created before first use, never collected.
    private static int _created;

    // One slot per object.
    private readonly int _id;

    public Counter() => _id = ++_created;
    public int Id => _id;
    public static int Created => _created;
}

static class Rates
{
    // Compile-time constant: the VALUE is copied into every call site.
    public const decimal Vat = 0.20m;

    // Run-time constant: one evaluation, callers read the field.
    public static readonly decimal Corporation = ComputeCorporationRate();

    // Mutable static: one value shared by everything in the process.
    public static decimal Adjustment = 0m;

    private static decimal ComputeCorporationRate()
    {
        Console.WriteLine("  (ComputeCorporationRate ran)");
        return 0.19m;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- instance state vs static state ---");
        var a = new Counter();
        var b = new Counter();
        var c = new Counter();
        Console.WriteLine($"  ids: {a.Id}, {b.Id}, {c.Id}");
        Console.WriteLine($"  Counter.Created (one slot for the type): {Counter.Created}");

        Console.WriteLine();
        Console.WriteLine("--- const vs static readonly vs static field ---");
        Console.WriteLine($"  const Vat            : {Rates.Vat}");
        Console.WriteLine($"  static readonly Corp : {Rates.Corporation}");
        Console.WriteLine($"  static Adjustment    : {Rates.Adjustment}");

        Rates.Adjustment = 0.05m;
        Console.WriteLine($"  after assignment     : {Rates.Adjustment}");
        Console.WriteLine("  (Vat and Corporation cannot be assigned — CS0131 and CS0198)");

        Console.WriteLine();
        Console.WriteLine("--- what the compiler records ---");
        foreach (var f in typeof(Rates).GetFields(BindingFlags.Public | BindingFlags.Static))
            Console.WriteLine($"  {f.Name,-14} IsLiteral={f.IsLiteral,-6} IsInitOnly={f.IsInitOnly,-6} " +
                              $"IsStatic={f.IsStatic}");
        Console.WriteLine("  IsLiteral=True means a true IL constant: no field is read at run time.");
        Console.WriteLine("  Note Vat is a const decimal and reports IsLiteral=False — the CLR has");
        Console.WriteLine("  no decimal literal, so the compiler emits a static readonly field plus");
        Console.WriteLine("  a DecimalConstantAttribute and inlines the value from that instead.");

        Console.WriteLine();
        Console.WriteLine($"  Rates is a static class: IsAbstract={typeof(Rates).IsAbstract}, " +
                          $"IsSealed={typeof(Rates).IsSealed}");
        Console.WriteLine("  A static class compiles to abstract + sealed, so it can be neither");
        Console.WriteLine("  instantiated nor inherited from.");
    }
}
