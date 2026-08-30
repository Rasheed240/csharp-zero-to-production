// Demo 3 — what boxing a million values costs, measured rather than asserted.
const int N = 1_000_000;

long before = GC.GetAllocatedBytesForCurrentThread();
List<object> boxedList = new List<object>(N);
for (int i = 0; i < N; i++)
{
    boxedList.Add(i);                    // boxes every single one
}
long after = GC.GetAllocatedBytesForCurrentThread();
Console.WriteLine($"List<object> of {N:N0} ints: {(after - before) / 1024.0 / 1024.0:F1} MB");

before = GC.GetAllocatedBytesForCurrentThread();
List<int> intList = new List<int>(N);
for (int i = 0; i < N; i++)
{
    intList.Add(i);                      // stored inline in one array
}
after = GC.GetAllocatedBytesForCurrentThread();
Console.WriteLine($"List<int>    of {N:N0} ints: {(after - before) / 1024.0 / 1024.0:F1} MB");

Console.WriteLine($"Gen 0 collections so far: {GC.CollectionCount(0)}");
