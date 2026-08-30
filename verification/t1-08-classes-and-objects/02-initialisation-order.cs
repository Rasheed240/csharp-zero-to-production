// Demo 2 — the exact order in which an object comes into existence.
// Printing each step is the only reliable way to learn this.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("Creating a Derived with an object initialiser:");
Console.WriteLine();

Derived d = new Derived(42) { Label = "set by object initialiser" };

Console.WriteLine();
Console.WriteLine($"final Label = {d.Label}");
Console.WriteLine();
Console.WriteLine("Order: derived FIELD INITIALISERS, then base field initialisers,");
Console.WriteLine("then the base CONSTRUCTOR BODY, then the derived constructor body,");
Console.WriteLine("and only afterwards the object initialiser.");

static class Log
{
    public static string Trace(string what)
    {
        Console.WriteLine($"  {what}");
        return what;
    }
}

class Base
{
    // Runs second: base field initialisers, after the derived ones.
    private readonly string _baseField = Log.Trace("2. base field initialiser");

    public Base()
    {
        Log.Trace("3. base constructor body");
        Log.Trace($"   (base can see its own field: {_baseField is not null})");
    }
}

class Derived : Base
{
    // Runs FIRST: derived field initialisers, before the base constructor.
    private readonly string _derivedField = Log.Trace("1. derived field initialiser");

    public Derived(int value)
    {
        // The base constructor has already finished by the time we get here.
        Log.Trace("4. derived constructor body");
        Log.Trace($"   (value parameter = {value})");
        Log.Trace($"   (Label is currently: {Label ?? "null"})");
    }

    public string? Label { get; set; }
}
