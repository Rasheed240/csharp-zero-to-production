// Compile-error probe. Each numbered line is expected to FAIL to compile.
// Uncomment one at a time to see the exact diagnostic.

List<MutableCounter> list = new List<MutableCounter> { new MutableCounter() };
MutableCounter[] array = new MutableCounter[1];
Box box = new Box();

// (0) compiles, mutation silently lost:
list[0].Increment();
Console.WriteLine($"after list[0].Increment(): {list[0].Count}");

// (1) expected CS1612:
list[0].Count = 5;

// (2) expected to compile and work (array indexer is a variable):
array[0].Count = 5;
Console.WriteLine($"after array[0].Count = 5: {array[0].Count}");

// (3) expected CS1612 (auto-property getter returns a copy):
box.Counter.Count = 5;

struct MutableCounter
{
    public int Count;
    public void Increment() => Count++;
}

class Box
{
    public MutableCounter Counter { get; set; }
}
