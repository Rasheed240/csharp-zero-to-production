// 07-minimal-example.cs — the module's minimal example, run.
// An infinite sequence is legal because the consumer decides when to stop.
// .NET 10.0.400. Run: dotnet run 07-minimal-example.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    // Runs forever if you let it. Nothing forces you to.
    static IEnumerable<long> Fibonacci()
    {
        long a = 0, b = 1;
        while (true)
        {
            yield return a;
            (a, b) = (b, a + b);
        }
    }

    static void Main()
    {
        foreach (var n in Fibonacci().Take(10))
            Console.Write($"{n} ");
        Console.WriteLine();

        // The first Fibonacci number over a million, without computing any others.
        Console.WriteLine(Fibonacci().First(n => n > 1_000_000));
    }
}
