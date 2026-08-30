using System;
using Contracts;

class Program
{
    static void Main()
    {
        var config = new PricingConfig(1.25m);

        // This one line is what the whole demonstration turns on.
        decimal markup = config.Markup;

        Console.WriteLine($"App read Markup = {markup}");
        Console.WriteLine($"Price of 80.00 becomes {80.00m * markup}");
    }
}
