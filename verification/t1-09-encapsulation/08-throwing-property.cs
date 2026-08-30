#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property NoWarn=IL2026;IL3050
// 08-throwing-property.cs — a public getter is not called only by your code.
// Serialisers, loggers, debuggers and data binding all read every public
// property. A getter that can throw makes all of them fail.
// .NET 10.0.400. Run: dotnet run 08-throwing-property.cs

using System;
using System.Text.Json;

class Shipment
{
    public string Reference { get; set; } = "";
    public decimal Weight { get; set; }
    public int BoxCount { get; set; }

    // Reads like a harmless derived value. Divides by a number that can be zero.
    public decimal WeightPerBox => Weight / BoxCount;
}

class SafeShipment
{
    public string Reference { get; set; } = "";
    public decimal Weight { get; set; }
    public int BoxCount { get; set; }

    // Same information, no way to throw.
    public decimal? WeightPerBox => BoxCount == 0 ? null : Weight / BoxCount;
}

class Program
{
    static void Main()
    {
        var good = new Shipment { Reference = "SHP-1", Weight = 12m, BoxCount = 3 };
        var bad = new Shipment { Reference = "SHP-2", Weight = 12m, BoxCount = 0 };

        Console.WriteLine("--- the good record serialises ---");
        Console.WriteLine(JsonSerializer.Serialize(good));

        Console.WriteLine();
        Console.WriteLine("--- the bad one takes the whole response with it ---");
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(bad));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"{ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"  inner: {ex.InnerException?.GetType().Name}: " +
                              $"{ex.InnerException?.Message}");
        }

        Console.WriteLine();
        Console.WriteLine("--- one bad record in a list of good ones ---");
        var batch = new[] { good, good, bad, good };
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(batch));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"the whole batch failed: {ex.GetType().Name}");
            Console.WriteLine($"  path reported: {(ex as JsonException)?.Path ?? "(none)"}");
        }

        Console.WriteLine();
        Console.WriteLine("--- ToString/interpolation hits it too ---");
        try
        {
            Console.WriteLine($"per box: {bad.WeightPerBox}");
        }
        catch (DivideByZeroException)
        {
            Console.WriteLine("logging the object threw DivideByZeroException");
        }

        Console.WriteLine();
        Console.WriteLine("--- the version that cannot throw ---");
        var safe = new SafeShipment { Reference = "SHP-2", Weight = 12m, BoxCount = 0 };
        Console.WriteLine(JsonSerializer.Serialize(safe));
    }
}
