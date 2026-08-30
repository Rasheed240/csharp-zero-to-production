// Demo 5 — when an object is created, when it becomes eligible for collection,
// and why finalisers are not a cleanup mechanism you can rely on.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. what an empty object costs");
long before = GC.GetAllocatedBytesForCurrentThread();
object plain = new object();
long afterPlain = GC.GetAllocatedBytesForCurrentThread();

Tiny tiny = new Tiny();
long afterTiny = GC.GetAllocatedBytesForCurrentThread();

Medium medium = new Medium();
long afterMedium = GC.GetAllocatedBytesForCurrentThread();

Console.WriteLine($"   new object()          : {afterPlain - before,3} bytes");
Console.WriteLine($"   class with one int    : {afterTiny - afterPlain,3} bytes");
Console.WriteLine($"   class with four longs : {afterMedium - afterTiny,3} bytes");
Console.WriteLine("   Every object carries a 16-byte header before its own fields.");
Console.WriteLine($"   (keeping them alive: {plain is not null} {tiny.Value} {medium.A})");
Console.WriteLine();

Console.WriteLine("2. an object lives while it is REACHABLE, not while it is 'in scope'");
Console.WriteLine($"   a fresh object starts in generation {GC.GetGeneration(new Tiny())}");

Tiny survivor = new Tiny();
GC.Collect();
GC.WaitForPendingFinalizers();
Console.WriteLine($"   after one collection, a referenced object is in generation {GC.GetGeneration(survivor)}");
GC.Collect();
Console.WriteLine($"   after two, generation {GC.GetGeneration(survivor)}");
Console.WriteLine("   Surviving a collection promotes an object. Long-lived objects end");
Console.WriteLine("   up in generation 2, which is collected rarely and expensively.");
Console.WriteLine();

Console.WriteLine("3. finalisers run at an unpredictable time, or not at all");
Console.WriteLine("   creating 3 objects with finalisers and dropping them...");
CreateAndDrop(3);

Console.WriteLine($"   finalised so far: {Finalisable.FinalisedCount}   (probably 0 - nothing has collected yet)");

GC.Collect();
GC.WaitForPendingFinalizers();
Console.WriteLine($"   after GC.Collect() + WaitForPendingFinalizers: {Finalisable.FinalisedCount}");
Console.WriteLine();
Console.WriteLine("   Note that took TWO steps: a finaliser does not run during the");
Console.WriteLine("   collection that finds the object. It is queued, then run later on a");
Console.WriteLine("   separate thread, so a finalisable object survives at least one extra");
Console.WriteLine("   collection. That is why finalisers make objects MORE expensive.");
Console.WriteLine();

Console.WriteLine("4. an object dies when it becomes UNREACHABLE, not when you drop it");

// Created inside a method so the local genuinely goes out of scope. Doing
// this inline would leave the variable rooted and prove nothing.
WeakReference weak = CreateWeakly();
Console.WriteLine($"   immediately after the method returned : IsAlive = {weak.IsAlive}");

GC.Collect();
GC.WaitForPendingFinalizers();
Console.WriteLine($"   after GC.Collect()                    : IsAlive = {weak.IsAlive}");
Console.WriteLine();
Console.WriteLine("   The object was unreachable the moment CreateWeakly returned, but the");
Console.WriteLine("   memory was not reclaimed until the collector ran. Reachability decides");
Console.WriteLine("   eligibility; the collector decides timing.");

static WeakReference CreateWeakly()
{
    Tiny local = new Tiny();
    return new WeakReference(local);
}

static void CreateAndDrop(int count)
{
    for (int i = 0; i < count; i++)
    {
        Finalisable dropped = new Finalisable();
        if (dropped.Id < 0) { Console.WriteLine("unreachable"); }
    }
    // Everything created here is unreachable once this method returns.
}

sealed class Tiny
{
    public int Value { get; } = 1;
}

sealed class Medium
{
    public long A { get; } = 1;
    public long B { get; } = 2;
    public long C { get; } = 3;
    public long D { get; } = 4;
}

sealed class Finalisable
{
    private static int _nextId;
    private static int _finalised;

    public Finalisable() => Id = Interlocked.Increment(ref _nextId);

    public int Id { get; }

    public static int FinalisedCount => _finalised;

    // A finaliser. The runtime calls this before reclaiming the object,
    // on its own thread, at a time nobody controls.
    ~Finalisable() => Interlocked.Increment(ref _finalised);
}
