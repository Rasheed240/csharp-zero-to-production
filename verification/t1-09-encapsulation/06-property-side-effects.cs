// 06-property-side-effects.cs — callers assume reading a property is cheap and
// harmless, because reading a field is. Code that reads like one field access
// can be many.
// .NET 10.0.400. Run: dotnet run -c Release 06-property-side-effects.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

class Invoice
{
    public static int LineLookups;
    public static int TotalComputations;

    private readonly int _id;
    public Invoice(int id) => _id = id;

    // Looks like data. Is a query.
    public IReadOnlyList<decimal> Lines
    {
        get
        {
            LineLookups++;
            var lines = new List<decimal>();
            for (int i = 0; i < 50; i++) lines.Add((_id + i) % 97);
            return lines;
        }
    }

    // Looks like a stored number. Recomputed on every read, from the property above.
    public decimal Total
    {
        get
        {
            TotalComputations++;
            decimal sum = 0m;
            foreach (var line in Lines) sum += line;
            return sum;
        }
    }
}

// Same data, honest surface.
class HonestInvoice
{
    public IReadOnlyList<decimal> Lines { get; }
    public decimal Total { get; }

    public HonestInvoice(int id)
    {
        var lines = new List<decimal>();
        for (int i = 0; i < 50; i++) lines.Add((id + i) % 97);
        Lines = lines;
        Total = lines.Sum();
    }
}

class Program
{
    static void Main()
    {
        var invoices = Enumerable.Range(1, 1000).Select(i => new Invoice(i)).ToList();

        Console.WriteLine("--- one innocuous-looking LINQ chain ---");
        Invoice.LineLookups = 0;
        Invoice.TotalComputations = 0;

        var big = invoices.Where(x => x.Total > 2000m)
                          .OrderByDescending(x => x.Total)
                          .Take(5)
                          .Select(x => x.Total)
                          .ToList();

        Console.WriteLine($"  returned {big.Count} values");
        Console.WriteLine($"  Total getter ran      {Invoice.TotalComputations,8:N0} times");
        Console.WriteLine($"  Lines getter ran      {Invoice.LineLookups,8:N0} times");
        Console.WriteLine($"  lists allocated       {Invoice.LineLookups,8:N0}");

        Console.WriteLine();
        Console.WriteLine("--- the same chain written to read each Total once ---");
        Invoice.LineLookups = 0;
        Invoice.TotalComputations = 0;

        var big2 = invoices.Select(x => x.Total)
                           .Where(t => t > 2000m)
                           .OrderByDescending(t => t)
                           .Take(5)
                           .ToList();

        Console.WriteLine($"  returned {big2.Count} values");
        Console.WriteLine($"  Total getter ran      {Invoice.TotalComputations,8:N0} times");
        Console.WriteLine($"  Lines getter ran      {Invoice.LineLookups,8:N0} times");

        Console.WriteLine();
        Console.WriteLine("--- what that costs in wall-clock time ---");
        var honest = Enumerable.Range(1, 1000).Select(i => new HonestInvoice(i)).ToList();

        Time("computed property", () =>
            invoices.Where(x => x.Total > 2000m).OrderByDescending(x => x.Total).Take(5).Count());
        Time("stored property", () =>
            honest.Where(x => x.Total > 2000m).OrderByDescending(x => x.Total).Take(5).Count());

        Console.WriteLine();
        Console.WriteLine("--- and the reason this hides from you in the debugger ---");
        Invoice.TotalComputations = 0;
        Invoice.LineLookups = 0;
        var one = invoices[0];
        // A watch window, a logger, and a serialiser each read every property once.
        _ = one.Total;
        _ = one.Total;
        _ = one.Total;
        Console.WriteLine($"  three inspections = {Invoice.TotalComputations} recomputations, " +
                          $"{Invoice.LineLookups} line rebuilds");
    }

    static void Time(string label, Func<int> body)
    {
        for (int i = 0; i < 20; i++) body();
        double best = double.MaxValue;
        for (int r = 0; r < 5; r++)
        {
            var sw = Stopwatch.StartNew();
            body();
            sw.Stop();
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        Console.WriteLine($"  {label,-20} {best,7:F2} ms per chain (best of 5)");
    }
}
