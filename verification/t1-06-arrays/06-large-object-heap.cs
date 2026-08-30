// Demo 6 — where an array is allocated depends on its SIZE IN BYTES, and the
// threshold is closer than most people expect.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("An object of 85,000 bytes or more goes on the Large Object Heap,");
Console.WriteLine("which is reported as generation 2 and is not compacted by default.");
Console.WriteLine();

Console.WriteLine($"{"element type",-14} {"bytes each",10} {"LOH from",12} {"elements",10}");
Console.WriteLine(new string('-', 50));
Report<byte>("byte", sizeof(byte));
Report<int>("int", sizeof(int));
Report<long>("long", sizeof(long));
Report<double>("double", sizeof(double));
Console.WriteLine();

// Find the exact length at which the runtime switches heaps, by asking the
// GC which generation each array landed in.
Console.WriteLine("measured, by searching for the first length reported as generation 2:");

int intBoundary = FirstLohLength(n => new int[n], 21_000, 21_400);
int stringBoundary = FirstLohLength(n => new string[n], 10_400, 10_800);

Console.WriteLine($"  first int[]    on the LOH: {intBoundary,7:N0} elements" +
    $"  ({(long)intBoundary * sizeof(int),7:N0} bytes payload)");
Console.WriteLine($"  first string[] on the LOH: {stringBoundary,7:N0} elements" +
    $"  ({(long)stringBoundary * IntPtr.Size,7:N0} bytes payload)");
Console.WriteLine();
Console.WriteLine("Both payloads are 84,976 bytes. Adding the 24-byte array header");
Console.WriteLine("(16-byte object header + 8-byte length) gives exactly 85,000.");
Console.WriteLine();

foreach (int length in new[] { 21_000, intBoundary - 1, intBoundary, 30_000 })
{
    int[] array = new int[length];
    array[0] = 1;   // touch it so nothing optimises it away
    Console.WriteLine(
        $"  new int[{length,6:N0}]  {(long)length * sizeof(int) + 24,8:N0} bytes total  -> generation {GC.GetGeneration(array)}");
}
Console.WriteLine();

Console.WriteLine($"gen-2 collections so far: {GC.CollectionCount(2)}");

static int FirstLohLength(Func<int, Array> create, int from, int to)
{
    for (int n = from; n <= to; n++)
    {
        Array candidate = create(n);
        if (GC.GetGeneration(candidate) == 2)
        {
            return n;
        }
    }
    return -1;
}

static void Report<T>(string name, int elementSize)
{
    // The 85,000-byte threshold covers the whole object, so subtract the
    // 24-byte array header before dividing.
    int elements = (85_000 - 24) / elementSize;
    Console.WriteLine($"{name,-14} {elementSize,10} {"85,000 B",12} {elements,10:N0}");
}
