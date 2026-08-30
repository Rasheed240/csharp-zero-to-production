// Demo 6 — the same text, parsed on machines in different countries.
// One input is rejected loudly. The other is accepted quietly, with a value
// one thousand times too large. The second is the one that reaches production.
using System.Globalization;

string[] cultures = { "en-GB", "en-US", "de-DE", "fr-FR" };

Show("1.234", "a price: one pound twenty-three");
Show("1,234.50", "a total: one thousand two hundred");

Console.WriteLine("Formatting has the same problem in reverse:");
Console.WriteLine();
decimal amount = 1234.5m;
foreach (string name in cultures)
{
    CultureInfo culture = CultureInfo.GetCultureInfo(name);
    Console.WriteLine($"  {amount} written by {name,-6} -> {amount.ToString("N2", culture)}");
}
Console.WriteLine($"  {amount} written by {"Invariant",-6} -> {amount.ToString("N2", CultureInfo.InvariantCulture)}");
Console.WriteLine();

Console.WriteLine("The fix, for any value crossing a machine boundary:");
if (decimal.TryParse("1.234", NumberStyles.Number, CultureInfo.InvariantCulture, out decimal safe))
{
    Console.WriteLine($"  TryParse with InvariantCulture -> {safe.ToString(CultureInfo.InvariantCulture)}");
}

Console.WriteLine();
Console.WriteLine("And for input that is genuinely not a number, prefer TryParse over Parse:");
Console.WriteLine($"  TryParse('not a number') -> {decimal.TryParse("not a number", NumberStyles.Number, CultureInfo.InvariantCulture, out _)}");
try
{
    decimal.Parse("not a number", CultureInfo.InvariantCulture);
}
catch (FormatException ex)
{
    Console.WriteLine($"  Parse('not a number')    -> throws {ex.GetType().Name}");
}

static void Show(string text, string intent)
{
    Console.WriteLine($"parsing \"{text}\"   ({intent})");
    Console.WriteLine();

    foreach (string name in new[] { "en-GB", "en-US", "de-DE", "fr-FR" })
    {
        CultureInfo culture = CultureInfo.GetCultureInfo(name);
        bool ok = decimal.TryParse(text, NumberStyles.Number, culture, out decimal value);
        string result = ok ? value.ToString(CultureInfo.InvariantCulture) : "REJECTED";
        Console.WriteLine($"  {name,-6} -> {result,12}");
    }

    bool invariantOk = decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal invariantValue);
    Console.WriteLine($"  {"Inv.",-6} -> {(invariantOk ? invariantValue.ToString(CultureInfo.InvariantCulture) : "REJECTED"),12}");
    Console.WriteLine();
}
