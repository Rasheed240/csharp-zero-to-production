// Demo 7 — var is not "any type". It is "work the type out from the right-hand
// side, at compile time, and then fix it forever".
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

var count = 10;              // int
var price = 10.5;            // double, NOT decimal
var money = 10.5m;           // decimal
var ratio = 1 / 2;           // int -> 0
var better = 1 / 2.0;        // double -> 0.5
var flag = true;             // bool
var letter = 'A';            // char
var text = "A";              // string
var numbers = new[] { 1, 2, 3 };

Console.WriteLine($"{"expression",-22} {"inferred type",-12} {"value"}");
Console.WriteLine(new string('-', 52));
Console.WriteLine($"{"var count = 10",-22} {count.GetType().Name,-12} {count}");
Console.WriteLine($"{"var price = 10.5",-22} {price.GetType().Name,-12} {price}");
Console.WriteLine($"{"var money = 10.5m",-22} {money.GetType().Name,-12} {money}");
Console.WriteLine($"{"var ratio = 1 / 2",-22} {ratio.GetType().Name,-12} {ratio}");
Console.WriteLine($"{"var better = 1 / 2.0",-22} {better.GetType().Name,-12} {better}");
Console.WriteLine($"{"var flag = true",-22} {flag.GetType().Name,-12} {flag}");
Console.WriteLine($"{"var letter = 'A'",-22} {letter.GetType().Name,-12} {letter}");
Console.WriteLine($"{"var text = \"A\"",-22} {text.GetType().Name,-12} {text}");
Console.WriteLine($"{"var numbers = new[]{1,2,3}",-22} {numbers.GetType().Name,-12} {numbers.Length} items");
Console.WriteLine();

// The type is fixed at compile time. This is a compile error, not a run-time one:
//     count = "ten";
// error CS0029: Cannot implicitly convert type 'string' to 'int'
Console.WriteLine("var is still statically typed: assigning a string to `count` is CS0029,");
Console.WriteLine("caught by the compiler, exactly as if you had written `int count = 10;`.");
Console.WriteLine();

// The trap worth remembering.
Console.WriteLine("The trap:");
Console.WriteLine($"  var vatRate = 20 / 100;      -> {20 / 100}      (int division, VAT is now zero)");
Console.WriteLine($"  var vatRate = 20 / 100m;     -> {20 / 100m}   (decimal, correct)");
Console.WriteLine($"  var vatRate = 0.2m;          -> {0.2m}   (clearest of the three)");
