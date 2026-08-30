// Demo 3 — the four ways a hidden copy silently eats your mutation.

Holder holder = new Holder();

holder.WritableField.Increment();
holder.ReadonlyField.Increment();

Console.WriteLine($"1. writable field  -> {holder.WritableField.Count}");
Console.WriteLine($"1. readonly field  -> {holder.ReadonlyField.Count}   <-- mutation lost");
Console.WriteLine();

MutableCounter viaIn = new MutableCounter();
IncrementThroughIn(in viaIn);
Console.WriteLine($"2. in parameter    -> {viaIn.Count}   <-- mutation lost");
Console.WriteLine();

// Arrays hand back a direct reference to the element, so this really mutates.
MutableCounter[] array = new MutableCounter[1];
array[0].Increment();
array[0].Increment();
Console.WriteLine($"3. array element   -> {array[0].Count}   <-- array mutation works");

// A List<T> indexer is a method returning a copy, so the compiler refuses:
//   list[0].Increment();   // CS1612 (cannot modify the return value)
// Iterating gives copies too:
List<MutableCounter> list = new List<MutableCounter> { new MutableCounter() };
foreach (MutableCounter item in list)
{
    item.Increment();
}
Console.WriteLine($"3. list via foreach-> {list[0].Count}   <-- mutation lost");
Console.WriteLine();

// The fix that removes the whole category of bug: make the type immutable.
SafeCounter safe = new SafeCounter(0);
SafeCounter safeIncremented = safe.Increment();
Console.WriteLine($"4. readonly struct -> original {safe.Count}, returned {safeIncremented.Count}");

static void IncrementThroughIn(in MutableCounter counter) => counter.Increment();

struct MutableCounter
{
    public int Count;
    public void Increment() => Count++;
}

class Holder
{
    public MutableCounter WritableField;
    public readonly MutableCounter ReadonlyField;
}

readonly struct SafeCounter
{
    public SafeCounter(int count) => Count = count;
    public int Count { get; }
    public SafeCounter Increment() => new SafeCounter(Count + 1);
}
