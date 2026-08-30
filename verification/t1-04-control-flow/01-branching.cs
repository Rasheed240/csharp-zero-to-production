// Demo 1 — the three ways to choose, and why guard clauses beat nesting.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("if / else if / else");
foreach (decimal amount in new[] { -5m, 0m, 25m, 5000m })
{
    Console.WriteLine($"  {amount,8} -> {Classify(amount)}");
}
Console.WriteLine();

Console.WriteLine("the conditional operator (one expression, not a statement)");
foreach (int count in new[] { 0, 1, 7 })
{
    string label = count == 1 ? "1 invoice" : $"{count} invoices";
    Console.WriteLine($"  {count} -> {label}");
}
Console.WriteLine();

Console.WriteLine("nested vs guard clauses - same answers, different shape");
foreach (string? reference in new[] { null, "", "INV-1", "INV-0000042" })
{
    Console.WriteLine($"  {reference ?? "(null)",-12} nested={NestedValidate(reference),-22} guarded={GuardedValidate(reference)}");
}

static string Classify(decimal amount)
{
    if (amount < 0m)
    {
        return "refund";
    }
    else if (amount == 0m)
    {
        return "zero";
    }
    else if (amount < 1000m)
    {
        return "standard";
    }
    else
    {
        return "large, needs review";
    }
}

// Every rule is nested inside the previous one. The happy path is buried at
// the deepest indentation, and adding a rule pushes it deeper still.
static string NestedValidate(string? reference)
{
    if (reference is not null)
    {
        if (reference.Length > 0)
        {
            if (reference.StartsWith("INV-", StringComparison.Ordinal))
            {
                if (reference.Length == 11)
                {
                    return "valid";
                }
                else
                {
                    return "wrong length";
                }
            }
            else
            {
                return "wrong prefix";
            }
        }
        else
        {
            return "empty";
        }
    }
    else
    {
        return "null";
    }
}

// Each failure is handled and dismissed immediately. The happy path is the
// last line, at the top level, where it is easy to find.
static string GuardedValidate(string? reference)
{
    if (reference is null)
    {
        return "null";
    }

    if (reference.Length == 0)
    {
        return "empty";
    }

    if (!reference.StartsWith("INV-", StringComparison.Ordinal))
    {
        return "wrong prefix";
    }

    if (reference.Length != 11)
    {
        return "wrong length";
    }

    return "valid";
}
