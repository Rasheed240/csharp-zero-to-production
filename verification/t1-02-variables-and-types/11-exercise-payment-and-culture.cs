// Exercise 2 and Exercise 3 worked solutions, verified.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// --- Exercise 2: the rewritten Payment ----------------------------------
string[] goodRow = { "1001", "1.234", "0.20", "2026-03-29T01:30:00+01:00" };
string[] badRow = { "1001", "not-a-number", "0.20", "2026-03-29T01:30:00+01:00" };
string[] shortRow = { "1001" };

Console.WriteLine("Exercise 2 - Payment.TryFromCsvRow");
Report(goodRow, "well-formed row");
Report(badRow, "malformed amount");
Report(shortRow, "too few columns");
Console.WriteLine();

// --- Exercise 3: the culture-independence test --------------------------
Console.WriteLine("Exercise 3 - the failing test, run against BOTH implementations");

Console.Write("  broken ReadAmount under de-DE : ");
try
{
    ParsingIsIndependentOfMachineCulture(BrokenReadAmount);
    Console.WriteLine("PASSED (unexpected)");
}
catch (Exception ex)
{
    Console.WriteLine($"FAILED - {ex.Message}");
}

Console.Write("  fixed  ReadAmount under de-DE : ");
try
{
    ParsingIsIndependentOfMachineCulture(FixedReadAmount);
    Console.WriteLine("PASSED");
}
catch (Exception ex)
{
    Console.WriteLine($"FAILED - {ex.Message}");
}

static void Report(string[] row, string label)
{
    bool ok = Payment.TryFromCsvRow(row, out Payment? payment);
    Console.WriteLine(ok
        ? $"  {label,-20} -> accepted: Id={payment!.Id}, Amount={payment.Amount}, Tax={payment.CalculateTax()}, At={payment.ProcessedAt:O}"
        : $"  {label,-20} -> rejected (no exception thrown)");
}

static void ParsingIsIndependentOfMachineCulture(Func<string, decimal> readAmount)
{
    CultureInfo original = CultureInfo.CurrentCulture;
    try
    {
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");

        decimal parsed = readAmount("1.234");

        if (parsed != 1.234m)
        {
            throw new Exception($"expected 1.234 but got {parsed.ToString(CultureInfo.InvariantCulture)}");
        }
    }
    finally
    {
        CultureInfo.CurrentCulture = original;
    }
}

static decimal BrokenReadAmount(string field) => decimal.Parse(field);

static decimal FixedReadAmount(string field)
{
    if (!decimal.TryParse(field, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal value))
    {
        throw new FormatException($"'{field}' is not a valid amount.");
    }
    return value;
}

public sealed class Payment
{
    public required long Id { get; init; }
    public required decimal Amount { get; init; }
    public required decimal TaxRate { get; init; }
    public required DateTimeOffset ProcessedAt { get; init; }
    public required long TotalPenceToDate { get; init; }

    public decimal CalculateTax() =>
        Math.Round(Amount * TaxRate, 2, MidpointRounding.AwayFromZero);

    public static bool TryFromCsvRow(string[] row, out Payment? payment)
    {
        payment = null;
        if (row.Length < 4)
        {
            return false;
        }

        CultureInfo invariant = CultureInfo.InvariantCulture;

        if (!long.TryParse(row[0], NumberStyles.Integer, invariant, out long id) ||
            !decimal.TryParse(row[1], NumberStyles.Number, invariant, out decimal amount) ||
            !decimal.TryParse(row[2], NumberStyles.Number, invariant, out decimal taxRate) ||
            !DateTimeOffset.TryParse(row[3], invariant, DateTimeStyles.RoundtripKind, out DateTimeOffset processedAt))
        {
            return false;
        }

        payment = new Payment
        {
            Id = id,
            Amount = amount,
            TaxRate = taxRate,
            ProcessedAt = processedAt,
            TotalPenceToDate = 0
        };
        return true;
    }
}
