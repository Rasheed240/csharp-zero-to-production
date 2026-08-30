// Demo 2 — the four ways an argument can be passed, and what each one lets the
// method do to the caller's variable.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("by value (the default)");
int a = 10;
PassByValue(a);
Console.WriteLine($"  after PassByValue(a)   : a = {a}   <-- unchanged");
Console.WriteLine();

Console.WriteLine("ref - the method works on the caller's variable");
int b = 10;
PassByRef(ref b);
Console.WriteLine($"  after PassByRef(ref b) : b = {b}");
Console.WriteLine();

Console.WriteLine("out - the method MUST assign it; the caller need not initialise it");
PassByOut(out int c);
Console.WriteLine($"  after PassByOut(out c) : c = {c}");
Console.WriteLine();

Console.WriteLine("in - passed by reference, but the method may not assign it");
int d = 10;
PassByIn(in d);
Console.WriteLine($"  after PassByIn(in d)   : d = {d}   <-- unchanged, by contract");
Console.WriteLine();

// The classic use of out: a method returning both success and a value.
Console.WriteLine("the out pattern that the framework uses everywhere");
foreach (string candidate in new[] { "42", "not a number" })
{
    if (int.TryParse(candidate, out int parsed))
    {
        Console.WriteLine($"  '{candidate}' parsed to {parsed}");
    }
    else
    {
        Console.WriteLine($"  '{candidate}' rejected (parsed is {parsed}, the default)");
    }
}
Console.WriteLine();

// ref on a reference type: two independent levels.
Console.WriteLine("ref on a reference type changes which object the caller points at");
Basket basket = new Basket("original");
MutateBasket(basket);
Console.WriteLine($"  after MutateBasket(basket)      : {basket.Name}");

ReplaceBasket(basket);
Console.WriteLine($"  after ReplaceBasket(basket)     : {basket.Name}   <-- caller unaffected");

ReplaceBasketByRef(ref basket);
Console.WriteLine($"  after ReplaceBasketByRef(ref b) : {basket.Name}");

static void PassByValue(int value) => value = 99;
static void PassByRef(ref int value) => value = 99;
static void PassByOut(out int value) => value = 99;
static void PassByIn(in int value) => Console.WriteLine($"  in parameter saw   : {value}");

static void MutateBasket(Basket basket) => basket.Name = "mutated";
static void ReplaceBasket(Basket basket) => basket = new Basket("replaced");
static void ReplaceBasketByRef(ref Basket basket) => basket = new Basket("replaced by ref");

sealed class Basket
{
    public Basket(string name) => Name = name;
    public string Name { get; set; }
}
