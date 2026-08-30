// Demo 7 — an array's length is fixed. "Resizing" allocates a new one and
// copies, which is why growing one element at a time is quadratic.
using System.Diagnostics;
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. Array.Resize does not resize anything");
int[] original = { 1, 2, 3 };
int[] alias = original;

Array.Resize(ref original, 5);

Console.WriteLine($"   original.Length          : {original.Length}");
Console.WriteLine($"   alias.Length             : {alias.Length}   <-- the old array, untouched");
Console.WriteLine($"   same object?             : {ReferenceEquals(original, alias)}");
Console.WriteLine($"   original contents        : {string.Join(",", original)}");
Console.WriteLine("   Resize allocated a new array, copied, and reassigned the ref parameter.");
Console.WriteLine();

Console.WriteLine("2. growing one element at a time is quadratic");
Console.WriteLine($"   {"items",8} {"Array.Resize",14} {"List<T>.Add",14}");
Console.WriteLine("   " + new string('-', 40));
foreach (int count in new[] { 10_000, 20_000, 40_000, 80_000 })
{
    long resizeMs = Time(() =>
    {
        int[] grown = Array.Empty<int>();
        for (int i = 0; i < count; i++)
        {
            Array.Resize(ref grown, grown.Length + 1);
            grown[i] = i;
        }
        return grown.Length;
    });

    long listMs = Time(() =>
    {
        List<int> grown = new List<int>();
        for (int i = 0; i < count; i++)
        {
            grown.Add(i);
        }
        return grown.Count;
    });

    Console.WriteLine($"   {count,8:N0} {resizeMs,11:N0} ms {listMs,11:N0} ms");
}
Console.WriteLine("   Doubling the count roughly quadruples the Resize time.");
Console.WriteLine("   List<T> doubles its buffer, so its total copying is linear.");
Console.WriteLine();

Console.WriteLine("3. List<T> capacity doubling, observed");
List<int> list = new List<int>();
int lastCapacity = -1;
for (int i = 0; i < 40; i++)
{
    list.Add(i);
    if (list.Capacity != lastCapacity)
    {
        Console.WriteLine($"   count {list.Count,3} -> capacity {list.Capacity,3}");
        lastCapacity = list.Capacity;
    }
}
Console.WriteLine("   Telling the constructor the expected size avoids every one of those copies.");
Console.WriteLine();

Console.WriteLine("4. copying an existing array");
int[] source = new int[1_000_000];
for (int i = 0; i < source.Length; i++) { source[i] = i; }

int[] destination = new int[source.Length];

long loopMs = Time(() =>
{
    for (int i = 0; i < source.Length; i++) { destination[i] = source[i]; }
    return destination.Length;
});

long arrayCopyMs = Time(() =>
{
    Array.Copy(source, destination, source.Length);
    return destination.Length;
});

long cloneMs = Time(() =>
{
    int[] copy = (int[])source.Clone();
    return copy.Length;
});

Console.WriteLine($"   element-by-element loop  : {loopMs,4} ms");
Console.WriteLine($"   Array.Copy               : {arrayCopyMs,4} ms");
Console.WriteLine($"   Clone (allocates too)    : {cloneMs,4} ms");

static long Time(Func<int> work)
{
    Stopwatch sw = Stopwatch.StartNew();
    int result = work();
    sw.Stop();
    if (result == int.MinValue) { Console.WriteLine("unreachable"); }
    return sw.ElapsedMilliseconds;
}
