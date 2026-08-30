// Demo 3 — the same 4,000,000 additions, in two different orders.
// Run with: dotnet run -c Release 03-cache-locality.cs
using System.Diagnostics;
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

const int Size = 2_000;          // 2000 x 2000 ints = 16 MB, far larger than any CPU cache
const int Repeats = 5;

int[,] grid = new int[Size, Size];
for (int row = 0; row < Size; row++)
{
    for (int column = 0; column < Size; column++)
    {
        grid[row, column] = row + column;
    }
}

// Warm up so JIT compilation is not part of either measurement.
_ = SumRowMajor(grid);
_ = SumColumnMajor(grid);

long rowMajorMs = Time(() => { long t = 0; for (int r = 0; r < Repeats; r++) { t += SumRowMajor(grid); } return t; });
long columnMajorMs = Time(() => { long t = 0; for (int r = 0; r < Repeats; r++) { t += SumColumnMajor(grid); } return t; });

Console.WriteLine($"{Size} x {Size} int grid ({(long)Size * Size * sizeof(int) / 1024 / 1024} MB), summed {Repeats} times");
Console.WriteLine();
Console.WriteLine($"  row-major    (i outer, j inner) : {rowMajorMs,6} ms");
Console.WriteLine($"  column-major (j outer, i inner) : {columnMajorMs,6} ms");
Console.WriteLine($"  ratio                           : {(double)columnMajorMs / Math.Max(rowMajorMs, 1),6:F1}x");
Console.WriteLine();
Console.WriteLine("Identical arithmetic. Identical element count. Only the ORDER differs.");
Console.WriteLine("Row-major walks memory forwards; column-major jumps 8,000 bytes each step.");

static long Time(Func<long> work)
{
    Stopwatch sw = Stopwatch.StartNew();
    long result = work();
    sw.Stop();
    if (result == long.MinValue) { Console.WriteLine("unreachable"); }
    return sw.ElapsedMilliseconds;
}

// C# lays a rectangular array out row by row, so this walks memory in order.
static long SumRowMajor(int[,] grid)
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

// Same elements, but each step jumps a whole row's width through memory.
static long SumColumnMajor(int[,] grid)
{
    long total = 0;
    int rows = grid.GetLength(0);
    int columns = grid.GetLength(1);

    for (int column = 0; column < columns; column++)
    {
        for (int row = 0; row < rows; row++)
        {
            total += grid[row, column];
        }
    }
    return total;
}
