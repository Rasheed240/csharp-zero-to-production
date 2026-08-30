// Demo 6 — the difference between an error the compiler catches and one it
// cannot. Both bugs are in the same file; only one stops the build.
//
// As written, this program COMPILES and then CRASHES. Uncomment the marked
// line to see the compiler refuse the build instead.

string[] currencies = { "GBP", "USD", "EUR" };

// (A) A compile-time error. Uncomment this and `dotnet run` never executes:
//     the compiler knows an int cannot hold a string.
// int wrong = currencies[0];

// (B) A run-time error. The compiler is satisfied: the type is right and the
//     index is an int. Whether index 7 exists is not knowable until it runs.
int index = int.Parse(Environment.GetEnvironmentVariable("CURRENCY_INDEX") ?? "7");

Console.WriteLine($"asking for currency at index {index} of {currencies.Length}");
Console.WriteLine($"the currency is {currencies[index]}");
