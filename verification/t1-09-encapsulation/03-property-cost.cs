// 03-property-cost.cs — does wrapping a field in a property cost anything?
// Measured, not asserted. .NET 10.0.400, Release, x64.
// Run: dotnet run -c Release 03-property-cost.cs

using System;
using System.Diagnostics;

class Holder
{
    public int Field;
    public int Auto { get; set; }

    private int _validated;
    public int Validated
    {
        get => _validated;
        set
        {
            if (value < 0) throw new ArgumentOutOfRangeException(nameof(value));
            _validated = value;
        }
    }

    public virtual int Virtual { get; set; }
}

class Derived : Holder
{
    public override int Virtual { get => base.Virtual; set => base.Virtual = value; }
}

class Program
{
    const int N = 200_000_000;

    static long ReadField(Holder h)
    {
        long sum = 0;
        for (int i = 0; i < N; i++) sum += h.Field;
        return sum;
    }

    static long ReadAuto(Holder h)
    {
        long sum = 0;
        for (int i = 0; i < N; i++) sum += h.Auto;
        return sum;
    }

    static long ReadValidated(Holder h)
    {
        long sum = 0;
        for (int i = 0; i < N; i++) sum += h.Validated;
        return sum;
    }

    static long ReadVirtual(Holder h)
    {
        long sum = 0;
        for (int i = 0; i < N; i++) sum += h.Virtual;
        return sum;
    }

    static void Time(string label, Func<Holder, long> body, Holder h, int rounds)
    {
        body(h);                                    // warm up / let the JIT tier up
        for (int r = 0; r < rounds; r++)
        {
            var sw = Stopwatch.StartNew();
            long sum = body(h);
            sw.Stop();
            Console.WriteLine($"  {label,-22} {sw.Elapsed.TotalMilliseconds,7:F1} ms   " +
                              $"(sum {sum}, {N / sw.Elapsed.TotalSeconds / 1e9,4:F2} G reads/s)");
        }
    }

    static void Main()
    {
        Console.WriteLine($"server GC: {System.Runtime.GCSettings.IsServerGC}, " +
                          $"64-bit: {Environment.Is64BitProcess}, N = {N:N0} per run");
        Console.WriteLine();

        var sealedHolder = new Holder { Field = 3, Auto = 3, Validated = 3, Virtual = 3 };
        var derivedHolder = new Derived { Field = 3, Auto = 3, Validated = 3, Virtual = 3 };

        Console.WriteLine("Reading through a reference whose exact type the JIT can see:");
        Time("public field", ReadField, sealedHolder, 3);
        Time("auto-property", ReadAuto, sealedHolder, 3);
        Time("property + validation", ReadValidated, sealedHolder, 3);
        Time("virtual property", ReadVirtual, sealedHolder, 3);

        Console.WriteLine();
        Console.WriteLine("Same virtual property, but two types are in play so it cannot be");
        Console.WriteLine("resolved to one target:");
        Time("virtual (base)", ReadVirtual, sealedHolder, 2);
        Time("virtual (derived)", ReadVirtual, derivedHolder, 2);
    }
}
