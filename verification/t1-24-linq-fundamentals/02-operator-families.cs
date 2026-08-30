// 02-operator-families.cs — the standard operators grouped by what they DO,
// and the one distinction that predicts most of their behaviour: whether an
// operator returns a sequence or a value.
// .NET 10.0.400. Run: dotnet run 02-operator-families.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Sale(string Rep, string Region, decimal Amount);

class Program
{
    static readonly Sale[] Sales =
    {
        new("ada",   "eu", 120m), new("grace", "eu", 300m),
        new("ada",   "us", 450m), new("linus", "eu",  80m),
        new("grace", "us", 900m), new("ada",   "eu", 220m)
    };

    static void Main()
    {
        Console.WriteLine("--- returns a SEQUENCE (deferred) ---");
        Show("Where", Sales.Where(s => s.Amount > 200m).Select(s => s.Rep));
        Show("Select", Sales.Select(s => s.Rep));
        Show("OrderBy", Sales.OrderBy(s => s.Amount).Select(s => s.Amount.ToString("0")));
        Show("ThenBy", Sales.OrderBy(s => s.Region).ThenByDescending(s => s.Amount)
                            .Select(s => $"{s.Region}:{s.Amount:0}"));
        Show("Distinct", Sales.Select(s => s.Rep).Distinct());
        Show("Skip/Take", Sales.Skip(1).Take(3).Select(s => s.Rep));
        Show("Concat", Sales.Take(1).Concat(Sales.TakeLast(1)).Select(s => s.Rep));
        Show("SelectMany", Sales.Take(2).SelectMany(s => s.Rep.ToCharArray()).Select(c => c.ToString()));
        Show("Reverse", Sales.Select(s => s.Rep).Reverse());

        Console.WriteLine();
        Console.WriteLine("--- returns a VALUE (executes immediately) ---");
        Console.WriteLine($"  {"Count",-14} {Sales.Count()}");
        Console.WriteLine($"  {"Count(pred)",-14} {Sales.Count(s => s.Region == "eu")}");
        Console.WriteLine($"  {"Sum",-14} {Sales.Sum(s => s.Amount):0.00}");
        Console.WriteLine($"  {"Average",-14} {Sales.Average(s => s.Amount):0.00}");
        Console.WriteLine($"  {"Min / Max",-14} {Sales.Min(s => s.Amount):0} / {Sales.Max(s => s.Amount):0}");
        Console.WriteLine($"  {"Any",-14} {Sales.Any(s => s.Amount > 800m)}");
        Console.WriteLine($"  {"All",-14} {Sales.All(s => s.Amount > 50m)}");
        Console.WriteLine($"  {"First",-14} {Sales.First(s => s.Region == "us").Rep}");
        Console.WriteLine($"  {"FirstOrDefault",-14} {Sales.FirstOrDefault(s => s.Amount > 9999m).Rep ?? "(default)"}");
        Console.WriteLine($"  {"Single",-14} {Sales.Single(s => s.Amount == 900m).Rep}");
        Console.WriteLine($"  {"Aggregate",-14} {Sales.Aggregate(0m, (acc, s) => acc + s.Amount):0.00}");
        Console.WriteLine($"  {"Contains",-14} {Sales.Select(s => s.Rep).Contains("linus")}");

        Console.WriteLine();
        Console.WriteLine("--- returns a COLLECTION (executes immediately) ---");
        Console.WriteLine($"  ToList     : {Sales.Select(s => s.Rep).ToList().Count} items");
        Console.WriteLine($"  ToArray    : {Sales.Select(s => s.Rep).ToArray().Length} items");
        Console.WriteLine($"  ToHashSet  : {Sales.Select(s => s.Rep).ToHashSet().Count} distinct");
        Console.WriteLine($"  ToDictionary: {Sales.GroupBy(s => s.Rep).ToDictionary(g => g.Key, g => g.Sum(x => x.Amount)).Count} keys");

        Console.WriteLine();
        Console.WriteLine("--- grouping and joining ---");
        foreach (var g in Sales.GroupBy(s => s.Rep).OrderBy(g => g.Key))
            Console.WriteLine($"  {g.Key,-6} count={g.Count()} total={g.Sum(s => s.Amount):0}");

        Console.WriteLine();
        Console.WriteLine("--- the Single/First distinction, which is a correctness choice ---");
        Console.WriteLine($"  First  on 3 eu sales : {Sales.First(s => s.Region == "eu").Rep}");
        try
        {
            Console.WriteLine($"  Single on 3 eu sales : {Sales.Single(s => s.Region == "eu").Rep}");
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  Single on 3 eu sales : {ex.GetType().Name} — {ex.Message}");
        }
        Console.WriteLine("  Single ASSERTS there is exactly one. First takes whatever comes.");
        Console.WriteLine("  Choosing First to avoid an exception hides a broken assumption.");
    }

    static void Show(string name, IEnumerable<string> result) =>
        Console.WriteLine($"  {name,-14} {string.Join(", ", result)}");
}
