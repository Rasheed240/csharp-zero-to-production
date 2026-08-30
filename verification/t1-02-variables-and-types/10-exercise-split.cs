// Exercise 4's worked solution, verified. Splits an amount by weights so the
// parts sum exactly to the input, with no penny created or destroyed.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Check(100.00m, new[] { 1, 1, 1 });
Check(10.00m, new[] { 1, 2, 3 });
Check(0.01m, new[] { 1, 1, 1 });

// A few extra cases the lesson does not print, checked here anyway.
Check(0.10m, new[] { 1, 1, 1 });
Check(1234.56m, new[] { 7, 11, 13, 17 });
Check(100.00m, new[] { 1 });

static void Check(decimal amount, int[] weights)
{
    decimal[] parts = Split(amount, weights);
    decimal sum = 0m;
    foreach (decimal part in parts)
    {
        sum += part;
    }

    Console.WriteLine($"{amount} split {string.Join(":", weights)} -> " +
        $"{string.Join(", ", parts)}  sum = {sum}  exact = {sum == amount}");
}

static decimal[] Split(decimal amount, int[] weights)
{
    ArgumentNullException.ThrowIfNull(weights);
    if (weights.Length == 0)
    {
        throw new ArgumentException("At least one weight is required.", nameof(weights));
    }

    long totalWeight = 0;
    foreach (int weight in weights)
    {
        if (weight < 0)
        {
            throw new ArgumentException("Weights cannot be negative.", nameof(weights));
        }
        totalWeight += weight;
    }

    if (totalWeight == 0)
    {
        throw new ArgumentException("Weights cannot all be zero.", nameof(weights));
    }

    decimal[] parts = new decimal[weights.Length];
    long runningWeight = 0;
    decimal previousBoundary = 0m;

    for (int i = 0; i < weights.Length; i++)
    {
        runningWeight += weights[i];

        // The exact cumulative amount owed after this share, rounded once.
        decimal boundary = i == weights.Length - 1
            ? amount                                     // the last boundary is the whole amount
            : Math.Round(amount * runningWeight / totalWeight, 2, MidpointRounding.ToEven);

        parts[i] = boundary - previousBoundary;
        previousBoundary = boundary;
    }

    return parts;
}
