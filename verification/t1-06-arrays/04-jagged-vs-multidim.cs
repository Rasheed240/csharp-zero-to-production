// Demo 4 — three ways to hold a 2,000 x 2,000 grid, summed identically.
// Run with: dotnet run -c Release 04-jagged-vs-multidim.cs
using System.Diagnostics;
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

const int Size = 2_000;
const int Repeats = 5;

// (a) rectangular: one object, one allocation
int[,] rectangular = new int[Size, Size];

// (b) jagged: an array of arrays. 2,001 separate objects.
int[][] jagged = new int[Size][];
for (int row = 0; row < Size; row++)
{
    jagged[row] = new int[Size];
}

// (c) flat: one 1-D array, indexed by hand
int[] flat = new int[Size * Size];

for (int row = 0; row < Size; row++)
{
    for (int column = 0; column < Size; column++)
    {
        int value = row + column;
        rectangular[row, column] = value;
        jagged[row][column] = value;
        flat[(row * Size) + column] = value;
    }
}

_ = SumRectangular(rectangular);
_ = SumJagged(jagged);
_ = SumFlat(flat, Size);

long rectMs = Time(() => { long t = 0; for (int r = 0; r < Repeats; r++) { t += SumRectangular(rectangular); } return t; });
long jaggedMs = Time(() => { long t = 0; for (int r = 0; r < Repeats; r++) { t += SumJagged(jagged); } return t; });
long flatMs = Time(() => { long t = 0; for (int r = 0; r < Repeats; r++) { t += SumFlat(flat, Size); } return t; });

Console.WriteLine($"{Size} x {Size} grid, summed {Repeats} times, all row-major:");
Console.WriteLine();
Console.WriteLine($"  rectangular int[,]   : {rectMs,5} ms   1 object");
Console.WriteLine($"  jagged      int[][]  : {jaggedMs,5} ms   {Size + 1:N0} objects");
Console.WriteLine($"  flat        int[]    : {flatMs,5} ms   1 object");
Console.WriteLine();
Console.WriteLine($"  rectangular / flat   : {(double)rectMs / Math.Max(flatMs, 1):F1}x");
Console.WriteLine($"  jagged / flat        : {(double)jaggedMs / Math.Max(flatMs, 1):F1}x");

static long Time(Func<long> work)
{
    Stopwatch sw = Stopwatch.StartNew();
    long result = work();
    sw.Stop();
    if (result == long.MinValue) { Console.WriteLine("unreachable"); }
    return sw.ElapsedMilliseconds;
}

static long SumRectangular(int[,] grid)
{
    long total = 0;
    int rows = grid.GetLength(0);
    int columns = grid.GetLength(1);
    for (int row = 0; row < rows; row++)
    {
        for (int column = 0; column < columns; column++)
        {
            total += grid[row, column];
        }
    }
    return total;
}

static long SumJagged(int[][] grid)
{
    long total = 0;
    for (int row = 0; row < grid.Length; row++)
    {
        int[] line = grid[row];
        for (int column = 0; column < line.Length; column++)
        {
            total += line[column];
        }
    }
    return total;
}

static long SumFlat(int[] grid, int size)
{
    long total = 0;
    for (int i = 0; i < grid.Length; i++)
    {
        total += grid[i];
    }
    return total;
}
