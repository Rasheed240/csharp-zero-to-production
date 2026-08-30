// Demo 5 — array covariance: a hole in the type system that C# inherited in
// 2002 and can never close. The compiler accepts code that throws at run time.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

string[] references = { "INV-1", "INV-2", "INV-3" };

// This assignment compiles. A string[] is treated as an object[].
object[] asObjects = references;

Console.WriteLine("array covariance");
Console.WriteLine($"  string[] assigned to object[] : compiles fine");
Console.WriteLine($"  asObjects.Length              : {asObjects.Length}");
Console.WriteLine($"  asObjects[0]                  : {asObjects[0]}");
Console.WriteLine($"  actual runtime type           : {asObjects.GetType().Name}");
Console.WriteLine();

// Reading is safe. Writing the wrong type is not, and only run time can tell.
Console.WriteLine("writing a string is fine:");
asObjects[0] = "INV-99";
Console.WriteLine($"  asObjects[0] = \"INV-99\"       -> {references[0]}");
Console.WriteLine();

Console.WriteLine("writing an int compiles, then throws:");
try
{
    asObjects[1] = 42;
    Console.WriteLine("  no exception (unexpected)");
}
catch (ArrayTypeMismatchException ex)
{
    Console.WriteLine($"  threw {ex.GetType().Name}");
    Console.WriteLine($"  message: {ex.Message}");
}
Console.WriteLine();

// Every write to an object[] therefore carries a hidden type check.
Console.WriteLine("the cost: every store into a covariant array is type-checked at run time");
Console.WriteLine("  (List<T> and Span<T> are NOT covariant, so they have no such check)");
Console.WriteLine();

// The generic collections got this right.
Console.WriteLine("the generic equivalent does not compile at all:");
Console.WriteLine("  List<string> names = new List<string>();");
Console.WriteLine("  List<object> objects = names;   // CS0029: cannot convert");
Console.WriteLine("  ^ the error arrives at build time, which is where you want it");
Console.WriteLine();

// IEnumerable<T> IS covariant, and safely so, because it is read-only.
IEnumerable<object> readOnly = references;
Console.WriteLine("IEnumerable<out T> is covariant and safe, because you cannot write to it:");
Console.WriteLine($"  IEnumerable<object> from string[] -> {string.Join(", ", readOnly)}");
