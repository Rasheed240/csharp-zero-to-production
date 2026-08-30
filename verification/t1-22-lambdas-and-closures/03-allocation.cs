// 03-allocation.cs — what capture costs, where the cost lands, and the capture
// that keeps a whole object alive without naming it.
// .NET 10.0.400, Release. Run: dotnet run 03-allocation.cs -c Release

using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;

class Program
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Use(Func<int, int> f) => f(1);

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Use2(Func<int, int, int> f) => f(1, 2);

    static void Report(string label, Action body)
    {
        for (int i = 0; i < 200; i++) body();
        long before = GC.GetTotalAllocatedBytes(precise: true);
        for (int i = 0; i < 1000; i++) body();
        long bytes = GC.GetTotalAllocatedBytes(precise: true) - before;
        Console.WriteLine($"  {label,-46} {bytes,8:N0} bytes / 1,000");
    }

    static void Main()
    {
        Console.WriteLine("--- what each shape allocates ---");
        Report("captures nothing", () => Use(x => x & 7));
        Report("static method group", () => Use(Square));

        int outerFixed = 7;
        Report("captures a local declared outside the loop", () => Use(x => x & outerFixed));

        Report("captures a local declared inside the loop", () =>
        {
            int inner = Environment.TickCount;
            Use(x => x & inner);
        });

        Report("captures two locals", () =>
        {
            int a = Environment.TickCount, b = a + 1;
            Use2((x, y) => (x & a) + (y & b));
        });

        Console.WriteLine();
        Console.WriteLine("  A closure is ONE object per scope, not one per captured variable:");
        Console.WriteLine("  capturing two locals from the same scope costs one display class");
        Console.WriteLine("  with two fields, plus one delegate.");

        Console.WriteLine();
        Console.WriteLine("--- passing the value instead of capturing it ---");
        Report("captures the value", () =>
        {
            int inner = Environment.TickCount;
            Use(x => x & inner);
        });
        Report("takes the value as an argument", () =>
        {
            int inner = Environment.TickCount;
            UseWithState(static (x, s) => x & s, inner);
        });

        Console.WriteLine();
        Console.WriteLine("--- capturing 'this' by accident ---");
        var holder = new Holder(99);
        Func<int, int> viaField = holder.MakeCapturingField();
        Func<int, int> viaLocal = holder.MakeCapturingLocal();

        Console.WriteLine($"  lambda using a FIELD  -> Target is {viaField.Target?.GetType().Name}");
        Console.WriteLine($"  lambda using a LOCAL  -> Target is {viaLocal.Target?.GetType().Name}");
        Console.WriteLine("  The first captured 'this', so the delegate keeps the whole Holder");
        Console.WriteLine("  alive. The second copied the field into a local first, so it keeps");
        Console.WriteLine("  only an int alive.");

        var weak = MakeAndDrop(out Func<int, int> keptAlive);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        Console.WriteLine($"  after a full GC, the captured Holder is still alive : {weak.IsAlive}");
        GC.KeepAlive(keptAlive);

        var weak2 = MakeAndDropLocal(out Func<int, int> keptAlive2);
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        Console.WriteLine($"  with only the int captured, the Holder is collected  : {!weak2.IsAlive}");
        GC.KeepAlive(keptAlive2);
    }

    static int Square(int x) => x & 7;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int UseWithState(Func<int, int, int> f, int state) => f(1, state);

    static WeakReference MakeAndDrop(out Func<int, int> kept)
    {
        var h = new Holder(1);
        kept = h.MakeCapturingField();
        return new WeakReference(h);
    }

    static WeakReference MakeAndDropLocal(out Func<int, int> kept)
    {
        var h = new Holder(1);
        kept = h.MakeCapturingLocal();
        return new WeakReference(h);
    }
}

sealed class Holder
{
    private readonly int _value;
    private readonly byte[] _ballast = new byte[10_000];
    public Holder(int value) => _value = value;

    // Uses a field, so the lambda captures 'this'.
    public Func<int, int> MakeCapturingField() => x => x + _value;

    // Copies the field into a local first, so only the int is captured.
    public Func<int, int> MakeCapturingLocal()
    {
        int local = _value;
        return x => x + local;
    }
}
