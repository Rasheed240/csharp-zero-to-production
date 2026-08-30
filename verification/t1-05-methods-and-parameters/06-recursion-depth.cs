// Demo 6 — every call consumes stack. Unbounded recursion exhausts it and
// kills the PROCESS: StackOverflowException cannot be caught.
//
//   dotnet run -c Release 06-recursion-depth.cs
//
// EXPECTED: this program crashes. The last number it prints is roughly how many
// frames fitted on the stack. Run it twice and the number will differ slightly.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("Counting how deep recursion can go before the stack runs out.");
Console.WriteLine("The process will die. That is the point of the demo.");
Console.WriteLine();

// Prove first that the safe, iterative version handles any depth.
Console.WriteLine($"iterative SumTo(1_000_000) = {SumToIteratively(1_000_000)}");
Console.WriteLine($"recursive SumTo(10_000)    = {SumToRecursively(10_000)}");
Console.WriteLine();

Console.WriteLine("now recursing without a base case:");
Console.Out.Flush();

try
{
    Recurse(1);
}
catch (Exception ex)
{
    // This never runs for a stack overflow. It is here to prove that.
    Console.WriteLine($"caught {ex.GetType().Name} - if you see this, it was not a stack overflow");
}

Console.WriteLine("this line is never reached");

static void Recurse(int depth)
{
    // Printing every 4,000 frames keeps the output readable and still lands
    // close to the true limit.
    if (depth % 4_000 == 0)
    {
        Console.WriteLine($"  depth {depth:N0}");
        Console.Out.Flush();
    }

    Recurse(depth + 1);
}

static long SumToIteratively(int n)
{
    long total = 0;
    for (int i = 1; i <= n; i++)
    {
        total += i;
    }
    return total;
}

static long SumToRecursively(int n) => n <= 0 ? 0 : n + SumToRecursively(n - 1);
