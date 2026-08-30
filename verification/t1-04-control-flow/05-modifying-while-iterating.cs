// Demo 5 — removing items from a collection you are looping over, and the
// three ways to do it that actually work.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. foreach + Remove -> throws on the NEXT iteration");
List<string> a = NewBatch();
try
{
    foreach (string reference in a)
    {
        if (reference.StartsWith("BAD", StringComparison.Ordinal))
        {
            a.Remove(reference);
        }
    }
    Console.WriteLine($"   survived: {string.Join(", ", a)}");
}
catch (InvalidOperationException ex)
{
    Console.WriteLine($"   threw InvalidOperationException: {ex.Message}");
}
Console.WriteLine();

Console.WriteLine("2. forwards for loop + RemoveAt -> skips items, no exception");
List<string> b = NewBatch();
for (int i = 0; i < b.Count; i++)
{
    if (b[i].StartsWith("BAD", StringComparison.Ordinal))
    {
        b.RemoveAt(i);
    }
}
Console.WriteLine($"   survived: {string.Join(", ", b)}   <-- BAD-2 is still here");
Console.WriteLine();

Console.WriteLine("3. backwards for loop -> correct, because removal only");
Console.WriteLine("   affects indexes AFTER the one being removed");
List<string> c = NewBatch();
for (int i = c.Count - 1; i >= 0; i--)
{
    if (c[i].StartsWith("BAD", StringComparison.Ordinal))
    {
        c.RemoveAt(i);
    }
}
Console.WriteLine($"   survived: {string.Join(", ", c)}");
Console.WriteLine();

Console.WriteLine("4. RemoveAll -> the same thing, in one line");
List<string> d = NewBatch();
int removed = d.RemoveAll(reference => reference.StartsWith("BAD", StringComparison.Ordinal));
Console.WriteLine($"   removed {removed}, survived: {string.Join(", ", d)}");
Console.WriteLine();

Console.WriteLine("5. build a new list instead of mutating the old one");
List<string> e = NewBatch();
List<string> kept = new List<string>();
foreach (string reference in e)
{
    if (!reference.StartsWith("BAD", StringComparison.Ordinal))
    {
        kept.Add(reference);
    }
}
Console.WriteLine($"   survived: {string.Join(", ", kept)}");
Console.WriteLine();

Console.WriteLine("6. which collections actually throw, measured on .NET 10");
Console.WriteLine();

Report("List<string>.Remove", () =>
{
    List<string> list = new List<string> { "a", "b", "c" };
    foreach (string item in list)
    {
        if (item == "b") { list.Remove(item); }
    }
});

Report("Dictionary.Remove", () =>
{
    Dictionary<string, int> map = new Dictionary<string, int> { ["a"] = 1, ["b"] = 0 };
    foreach (KeyValuePair<string, int> entry in map)
    {
        if (entry.Value == 0) { map.Remove(entry.Key); }
    }
});

Report("Dictionary.Add", () =>
{
    Dictionary<string, int> map = new Dictionary<string, int> { ["a"] = 1, ["b"] = 0 };
    foreach (KeyValuePair<string, int> entry in map)
    {
        if (entry.Value == 0) { map["new"] = 9; }
    }
});

Report("Dictionary update existing key", () =>
{
    Dictionary<string, int> map = new Dictionary<string, int> { ["a"] = 1, ["b"] = 0 };
    foreach (KeyValuePair<string, int> entry in map)
    {
        if (entry.Value == 0) { map["a"] = 99; }
    }
});

Report("HashSet.Remove", () =>
{
    HashSet<string> set = new HashSet<string> { "a", "b", "c" };
    foreach (string item in set)
    {
        if (item == "b") { set.Remove(item); }
    }
});

Console.WriteLine();
Console.WriteLine("Dictionary and HashSet allow Remove during enumeration from .NET Core 3.0");
Console.WriteLine("onwards. List does not, and Dictionary.Add still does not. Relying on the");
Console.WriteLine("permitted cases teaches a habit that breaks the moment the collection type");
Console.WriteLine("changes, so prefer RemoveAll, a backwards loop, or building a new list.");

static void Report(string label, Action action)
{
    try
    {
        action();
        Console.WriteLine($"  {label,-32} allowed");
    }
    catch (InvalidOperationException)
    {
        Console.WriteLine($"  {label,-32} throws InvalidOperationException");
    }
}

static List<string> NewBatch() =>
    new List<string> { "INV-1", "BAD-1", "BAD-2", "INV-2", "BAD-3" };
