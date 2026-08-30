// Demo 3 — switch statements, switch expressions, and why C# refuses to let
// one case fall into the next.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

string[] statuses = { "pending", "authorised", "captured", "refunded", "chargeback", "banana" };

Console.WriteLine("switch statement");
foreach (string status in statuses)
{
    Console.WriteLine($"  {status,-12} -> {DescribeWithStatement(status)}");
}
Console.WriteLine();

Console.WriteLine("switch expression - the same rules, as one expression");
foreach (string status in statuses)
{
    Console.WriteLine($"  {status,-12} -> {DescribeWithExpression(status)}");
}
Console.WriteLine();

Console.WriteLine("switching on an integer, which the JIT can turn into a jump table");
for (int code = 0; code <= 6; code++)
{
    Console.WriteLine($"  {code} -> {DescribeCode(code)}");
}

static string DescribeWithStatement(string status)
{
    switch (status)
    {
        // Empty labels stacked together share one body. This is the only
        // form of "fall through" C# allows.
        case "pending":
        case "authorised":
            return "money not moved yet";

        case "captured":
            return "money taken";

        case "refunded":
            return "money returned";

        case "chargeback":
            return "money taken back by the bank";

        default:
            return $"unknown status '{status}'";
    }
}

static string DescribeWithExpression(string status) => status switch
{
    "pending" or "authorised" => "money not moved yet",
    "captured" => "money taken",
    "refunded" => "money returned",
    "chargeback" => "money taken back by the bank",
    _ => $"unknown status '{status}'"
};

static string DescribeCode(int code) => code switch
{
    0 => "created",
    1 => "pending",
    2 => "authorised",
    3 => "captured",
    4 => "refunded",
    5 => "chargeback",
    _ => "unknown"
};
