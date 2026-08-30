// 05-minimal-example.cs — the module's minimal example, run.
// .NET 10.0.400. Run: dotnet run 05-minimal-example.cs
#:property Nullable=enable

using System;

class Program
{
    static decimal Divide(decimal numerator, decimal denominator)
    {
        if (denominator == 0m)
            throw new ArgumentOutOfRangeException(
                nameof(denominator), denominator, "denominator must not be zero");

        return numerator / denominator;
    }

    static void Main()
    {
        foreach (var d in new[] { 4m, 0m })
        {
            try
            {
                Console.WriteLine($"100 / {d} = {Divide(100m, d)}");
            }
            catch (ArgumentOutOfRangeException ex)
            {
                Console.WriteLine($"{ex.GetType().Name}: {ex.Message}");
                Console.WriteLine($"  ParamName   = {ex.ParamName}");
                Console.WriteLine($"  ActualValue = {ex.ActualValue}");
            }
            finally
            {
                Console.WriteLine($"  (finally ran for {d})");
            }
        }
    }
}
