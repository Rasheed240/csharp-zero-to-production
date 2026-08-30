// Demo 1 — a method, its signature, and the difference between a parameter and
// an argument.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// 100m and 20 are ARGUMENTS. amount and vatPercent are PARAMETERS.
decimal withVat = AddVat(100m, 20);
Console.WriteLine($"AddVat(100m, 20)        = {withVat}");

// A method with no return value has the return type void.
Announce("batch started");

// Expression-bodied form, for methods that are a single expression.
Console.WriteLine($"Double(21)              = {Double(21)}");

// A local function: a method declared inside another method. It can see the
// enclosing method's variables, and it cannot be overloaded.
decimal runningTotal = 0m;
void AddToTotal(decimal amount) => runningTotal += amount;

AddToTotal(10m);
AddToTotal(32m);
Console.WriteLine($"runningTotal            = {runningTotal}");

// Methods can call themselves. This one has a base case, so it terminates.
Console.WriteLine($"Factorial(10)           = {Factorial(10)}");

// The signature is the name plus the parameter types. The return type is NOT
// part of it, which is why these two can coexist but two methods differing
// only by return type cannot.
Console.WriteLine($"Format(42)              = {Formatter.Format(42)}");
Console.WriteLine($"Format(\"42\")            = {Formatter.Format("42")}");

static decimal AddVat(decimal amount, int vatPercent)
{
    return amount + (amount * vatPercent / 100m);
}

static void Announce(string message)
{
    Console.WriteLine($"[ledger] {message}");
    // No return statement is needed in a void method, but 'return;' is legal
    // and is how you leave early.
}

static int Double(int value) => value * 2;

static long Factorial(int n)
{
    if (n <= 1)
    {
        return 1;        // the base case: without it this never terminates
    }
    return n * Factorial(n - 1);
}

public static class Formatter
{
    public static string Format(int value) => $"int:{value}";
    public static string Format(string value) => $"string:{value}";
}
