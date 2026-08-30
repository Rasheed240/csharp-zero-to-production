// Demo 4 — optional parameters and named arguments, and what each one commits
// you to as an API author.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("optional parameters: omit from the right");
Console.WriteLine($"  Charge(100m)                          -> {Gateway.Charge(100m)}");
Console.WriteLine($"  Charge(100m, \"USD\")                   -> {Gateway.Charge(100m, "USD")}");
Console.WriteLine($"  Charge(100m, \"USD\", true)             -> {Gateway.Charge(100m, "USD", true)}");
Console.WriteLine();

Console.WriteLine("named arguments: skip the middle, or reorder entirely");
Console.WriteLine($"  Charge(100m, capture: true)           -> {Gateway.Charge(100m, capture: true)}");
Console.WriteLine($"  Charge(currency: \"EUR\", amount: 100m) -> {Gateway.Charge(currency: "EUR", amount: 100m)}");
Console.WriteLine();

Console.WriteLine("named arguments also rescue an unreadable call site");
Console.WriteLine($"  Transfer(100m, \"A\", \"B\", true, false) -> {Ledger.Transfer(100m, "A", "B", true, false)}");
Console.WriteLine($"  the same call, named                  -> {Ledger.Transfer(
    amount: 100m,
    fromAccount: "A",
    toAccount: "B",
    notify: true,
    reverseOnFailure: false)}");
Console.WriteLine();

Console.WriteLine("evaluation still happens in the order WRITTEN, not parameter order");
int counter = 0;
string result = Ledger.Trace(second: Next(ref counter), first: Next(ref counter));
Console.WriteLine($"  Trace(second: Next(), first: Next())  -> {result}");
Console.WriteLine("  the argument written first was evaluated first, despite being 'second'");

static int Next(ref int counter) => counter++;

public static class Gateway
{
    public static string Charge(decimal amount, string currency = "GBP", bool capture = false) =>
        $"{amount} {currency}, capture={capture}";
}

public static class Ledger
{
    public static string Transfer(
        decimal amount,
        string fromAccount,
        string toAccount,
        bool notify,
        bool reverseOnFailure) =>
        $"{amount} {fromAccount}->{toAccount} notify={notify} reverse={reverseOnFailure}";

    public static string Trace(int first, int second) => $"first={first}, second={second}";
}
