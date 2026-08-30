// Demo 5 — the intern pool, and why a string's hash code is not stable.
using System.Globalization;
using System.Text;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. identical literals are the SAME object");
string a = "INV-2026";
string b = "INV-2026";
Console.WriteLine($"   a == b                  : {a == b}");
Console.WriteLine($"   ReferenceEquals(a, b)   : {ReferenceEquals(a, b)}   <-- one object, two names");
Console.WriteLine();

Console.WriteLine("2. a string built at RUN TIME is a different object");
string prefix = "INV-";
string year = "2026";
string built = prefix + year;
Console.WriteLine($"   built == a              : {built == a}");
Console.WriteLine($"   ReferenceEquals(built,a): {ReferenceEquals(built, a)}   <-- equal value, different object");
Console.WriteLine();

Console.WriteLine("3. constants ARE folded at compile time, so these are interned");
const string ConstPrefix = "INV-";
const string ConstYear = "2026";
string folded = ConstPrefix + ConstYear;
Console.WriteLine($"   ReferenceEquals(folded,a): {ReferenceEquals(folded, a)}   <-- the compiler produced one literal");
Console.WriteLine();

Console.WriteLine("4. string.Intern puts a runtime string into the pool");
string interned = string.Intern(built);
Console.WriteLine($"   ReferenceEquals(interned, a) : {ReferenceEquals(interned, a)}");
Console.WriteLine($"   IsInterned(built) is null?   : {string.IsInterned(built) is null}");
Console.WriteLine();

Console.WriteLine("   WARNING: interned strings live for the life of the process. They are");
Console.WriteLine("   never collected. Interning user-supplied values is an unbounded leak.");
Console.WriteLine();

Console.WriteLine("5. why == is safe anyway: it compares VALUE, not reference");
StringBuilder sb = new StringBuilder();
sb.Append("INV-").Append("2026");
string fromBuilder = sb.ToString();
Console.WriteLine($"   fromBuilder == a             : {fromBuilder == a}");
Console.WriteLine($"   ReferenceEquals(fromBuilder,a): {ReferenceEquals(fromBuilder, a)}");
Console.WriteLine("   Never use ReferenceEquals (or object.Equals) to compare string values.");
Console.WriteLine();

Console.WriteLine("6. GetHashCode is randomised per process");
Console.WriteLine($"   \"INV-2026\".GetHashCode() : {a.GetHashCode()}");
Console.WriteLine("   Run this program again: the number will be DIFFERENT.");
Console.WriteLine("   Never persist or share a string hash code between processes.");
Console.WriteLine();

Console.WriteLine("   a deterministic alternative, when you need one across processes:");
Console.WriteLine($"   ordinal comparer hash     : {StringComparer.Ordinal.GetHashCode(a)}   (also per-process)");
byte[] bytes = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(a));
Console.WriteLine($"   SHA-256 of the UTF-8 bytes: {Convert.ToHexString(bytes)[..16]}...  (stable everywhere)");
Console.WriteLine();

Console.WriteLine("7. a dictionary keyed by string should say which comparison it uses");
Dictionary<string, int> caseSensitive = new Dictionary<string, int>(StringComparer.Ordinal);
Dictionary<string, int> caseInsensitive = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

caseSensitive["INV-1"] = 1;
caseInsensitive["INV-1"] = 1;

Console.WriteLine($"   ordinal dictionary contains \"inv-1\"          : {caseSensitive.ContainsKey("inv-1")}");
Console.WriteLine($"   OrdinalIgnoreCase dictionary contains \"inv-1\": {caseInsensitive.ContainsKey("inv-1")}");
