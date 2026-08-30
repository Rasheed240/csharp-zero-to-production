// Demo 5 — the same invoice priced twice: once in double, once in decimal.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// Three ordinary line items. Nothing contrived: these are prices a real
// invoice would carry.
(string Description, decimal UnitPrice, int Quantity)[] lines =
{
    ("Consulting, March", 2.675m, 1),
    ("Hosting, March", 1.005m, 1),
    ("Support retainer", 8.615m, 1)
};

Console.WriteLine("Rounding each line to the penny, then summing.");
Console.WriteLine();
Console.WriteLine($"{"line",-20} {"raw",10} {"double",10} {"decimal",10}");
Console.WriteLine(new string('-', 54));

double doubleTotal = 0.0;
decimal decimalTotal = 0m;

foreach ((string description, decimal unitPrice, int quantity) in lines)
{
    double asDouble = (double)unitPrice * quantity;
    decimal asDecimal = unitPrice * quantity;

    double roundedDouble = Math.Round(asDouble, 2, MidpointRounding.AwayFromZero);
    decimal roundedDecimal = Math.Round(asDecimal, 2, MidpointRounding.AwayFromZero);

    doubleTotal += roundedDouble;
    decimalTotal += roundedDecimal;

    Console.WriteLine($"{description,-20} {unitPrice,10} {roundedDouble,10:F2} {roundedDecimal,10:F2}");
}

Console.WriteLine(new string('-', 54));
Console.WriteLine($"{"TOTAL",-20} {"",10} {doubleTotal,10:F2} {decimalTotal,10:F2}");
Console.WriteLine();

decimal difference = decimalTotal - (decimal)doubleTotal;
Console.WriteLine($"difference: {difference:F2}  ({difference * 100m:F0} pence)");
Console.WriteLine();

// Why: the double never held the value the invoice said it held.
Console.WriteLine("what the double actually stored:");
foreach ((string description, decimal unitPrice, int _) in lines)
{
    double stored = (double)unitPrice;
    Console.WriteLine($"  {unitPrice,8}  ->  {stored.ToString("F20")}");
}
Console.WriteLine();
Console.WriteLine("Every one of those three is stored inexactly, but only 1.005 changed the answer:");
Console.WriteLine("  1.005 is really 1.00499999..., which is below the midpoint, so it rounds DOWN");
Console.WriteLine("  to 1.00. The decimal type holds 1.005 exactly and rounds UP to 1.01.");
Console.WriteLine();
Console.WriteLine("Note that 2.675 is stored just as inexactly and still rounded up. You cannot");
Console.WriteLine("predict which prices will break by looking at them, which is exactly why the");
Console.WriteLine("rule is 'never double for money' rather than 'be careful with doubles'.");
