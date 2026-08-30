// Demo 3 — which overload actually gets called, and the cases that surprise.
//
// Note: these live in a static class rather than as top-level local functions,
// because LOCAL FUNCTIONS CANNOT BE OVERLOADED. Declaring two with the same
// name is CS0128, "already defined in this scope".
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("numeric overloads - the compiler picks the most specific match");
Console.WriteLine($"  Describe(5)        -> {Api.Describe(5)}");
Console.WriteLine($"  Describe(5L)       -> {Api.Describe(5L)}");
Console.WriteLine($"  Describe(5.0)      -> {Api.Describe(5.0)}");
Console.WriteLine($"  Describe(5.0m)     -> {Api.Describe(5.0m)}");
Console.WriteLine($"  Describe('a')      -> {Api.Describe('a')}      <-- char widens to int");
Console.WriteLine($"  Describe((byte)5)  -> {Api.Describe((byte)5)}      <-- byte widens to int");
Console.WriteLine($"  Describe((short)5) -> {Api.Describe((short)5)}      <-- short widens to int");
Console.WriteLine($"  Describe(5.0f)     -> {Api.Describe(5.0f)}   <-- float widens to double");
Console.WriteLine();

Console.WriteLine("reference overloads - the most DERIVED match wins, and null is typed");
Console.WriteLine($"  Log(\"text\")        -> {Api.Log("text")}");
Console.WriteLine($"  Log(new object())  -> {Api.Log(new object())}");
Console.WriteLine($"  Log(null)          -> {Api.Log(null)}   <-- string, not object");
Console.WriteLine($"  Log((object?)null) -> {Api.Log((object?)null)}   <-- the cast picks the other one");
Console.WriteLine();

Console.WriteLine("an exact overload beats one reached via an optional parameter");
Console.WriteLine($"  Charge(100m)       -> {Api.Charge(100m)}");
Console.WriteLine($"  Charge(100m, 5)    -> {Api.Charge(100m, 5)}");
Console.WriteLine();

Console.WriteLine("arguments are evaluated left to right, before the call happens");
int counter = 0;
Console.WriteLine($"  Order(counter++, counter++, counter++) -> {Api.Order(counter++, counter++, counter++)}");
Console.WriteLine($"  counter afterwards -> {counter}");

public static class Api
{
    public static string Describe(int value) => "int";
    public static string Describe(long value) => "long";
    public static string Describe(double value) => "double";
    public static string Describe(decimal value) => "decimal";

    public static string Log(string? message) => "string overload";
    public static string Log(object? message) => "object overload";

    // An exact one-argument overload alongside one with an optional parameter.
    public static string Charge(decimal amount) => "exact match, no optional";
    public static string Charge(decimal amount, int feePercent = 2) => $"optional used, fee {feePercent}";

    public static string Order(int first, int second, int third) => $"{first},{second},{third}";
}
