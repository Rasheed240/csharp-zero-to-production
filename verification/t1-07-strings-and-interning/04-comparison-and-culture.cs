// Demo 4 — comparing strings. The default is not always what you want, and one
// of the wrong answers is a real security bug.
using System.Globalization;

Console.WriteLine("1. == and Equals are ORDINAL: they compare UTF-16 code units");
string a = "Ledger";
string b = "ledger";
Console.WriteLine($"   \"Ledger\" == \"ledger\"                          -> {a == b}");
Console.WriteLine($"   Equals(OrdinalIgnoreCase)                     -> {string.Equals(a, b, StringComparison.OrdinalIgnoreCase)}");
Console.WriteLine();

Console.WriteLine("2. the Turkish I: ToUpper depends on the machine's culture");
string identifier = "file";
foreach (string culture in new[] { "en-GB", "en-US", "tr-TR", "az-AZ" })
{
    CultureInfo info = CultureInfo.GetCultureInfo(culture);
    string upper = identifier.ToUpper(info);
    Console.WriteLine($"   \"file\".ToUpper({culture,-6}) -> \"{upper}\"   equals \"FILE\"? {upper == "FILE"}");
}
Console.WriteLine($"   \"file\".ToUpperInvariant()   -> \"{identifier.ToUpperInvariant()}\"   equals \"FILE\"? {identifier.ToUpperInvariant() == "FILE"}");
Console.WriteLine();

Console.WriteLine("   the same problem in the other direction:");
string upperI = "FILE";
foreach (string culture in new[] { "en-GB", "tr-TR" })
{
    CultureInfo info = CultureInfo.GetCultureInfo(culture);
    Console.WriteLine($"   \"FILE\".ToLower({culture,-6}) -> \"{upperI.ToLower(info)}\"");
}
Console.WriteLine();

Console.WriteLine("3. a security check that passes on one machine and fails on another");
string[] blocked = { "admin", "root" };
foreach (string culture in new[] { "en-GB", "tr-TR" })
{
    CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);

    // WRONG: culture-sensitive lowering of a security-relevant identifier.
    string requested = "ADMIN";
    bool blockedNaive = Array.IndexOf(blocked, requested.ToLower()) >= 0;

    // RIGHT: ordinal, culture-independent.
    bool blockedCorrect = blocked.Contains(requested, StringComparer.OrdinalIgnoreCase);

    Console.WriteLine($"   culture {culture,-6}: ToLower() blocks \"ADMIN\"? {blockedNaive,-5}   ordinal blocks it? {blockedCorrect}");
}
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
Console.WriteLine();

Console.WriteLine("4. sorting order differs by culture, and ordinal differs from all of them");

string[] words = { "Zebra", "Arger", "Apfel" };
words[1] = "Ärger";   // Arger with an umlaut

Console.WriteLine($"   input: {string.Join(" ", words)}");
foreach (string culture in new[] { "en-GB", "de-DE", "sv-SE" })
{
    string[] copy = (string[])words.Clone();
    Array.Sort(copy, StringComparer.Create(CultureInfo.GetCultureInfo(culture), ignoreCase: false));
    Console.WriteLine($"   {culture,-8} {string.Join(" ", copy)}");
}

string[] ordinalOrder = (string[])words.Clone();
Array.Sort(ordinalOrder, StringComparer.Ordinal);
Console.WriteLine($"   {"ordinal",-8} {string.Join(" ", ordinalOrder)}");
Console.WriteLine("   Swedish sorts A-umlaut AFTER Z; German and English sort it with A.");
Console.WriteLine();

string[] cases = { "apple", "Apple", "APPLE" };
Console.WriteLine($"   input: {string.Join(" ", cases)}");
foreach (string culture in new[] { "en-GB", "de-DE" })
{
    string[] copy = (string[])cases.Clone();
    Array.Sort(copy, StringComparer.Create(CultureInfo.GetCultureInfo(culture), ignoreCase: false));
    Console.WriteLine($"   {culture,-8} {string.Join(" ", copy)}");
}
string[] ordinalCases = (string[])cases.Clone();
Array.Sort(ordinalCases, StringComparer.Ordinal);
Console.WriteLine($"   {"ordinal",-8} {string.Join(" ", ordinalCases)}");
Console.WriteLine("   Ordinal puts uppercase first, because A is code unit 65 and a is 97.");
Console.WriteLine();

Console.WriteLine("5. equal-looking strings that are not equal: Unicode normalisation");
string composed = "é";              // e-acute as ONE code point
string decomposed = "é";           // 'e' + combining acute accent
Console.WriteLine($"   composed   : \"{composed}\"  Length={composed.Length}");
Console.WriteLine($"   decomposed : \"{decomposed}\"  Length={decomposed.Length}");
Console.WriteLine($"   ordinal equal?                    -> {string.Equals(composed, decomposed, StringComparison.Ordinal)}");
Console.WriteLine($"   after Normalize()                 -> {string.Equals(composed.Normalize(), decomposed.Normalize(), StringComparison.Ordinal)}");
Console.WriteLine($"   culture-sensitive (InvariantCulture) -> {string.Equals(composed, decomposed, StringComparison.InvariantCulture)}");
Console.WriteLine();

Console.WriteLine("6. which comparison to use");
Console.WriteLine("   Ordinal / OrdinalIgnoreCase : identifiers, keys, paths, protocol tokens");
Console.WriteLine("   CurrentCulture              : text a human reads and sorts on screen");
Console.WriteLine("   InvariantCulture            : rarely; it is a culture, not 'no culture'");
