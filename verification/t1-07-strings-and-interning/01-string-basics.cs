// Demo 1 — a string cannot be changed. Everything that looks like a change
// returns a new one.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. every 'modification' returns a NEW string");
string reference = "inv-2026-0042";
string upper = reference.ToUpperInvariant();
string trimmed = "  spaced  ".Trim();
string replaced = reference.Replace("inv", "receipt");

Console.WriteLine($"   original            : {reference}   <-- unchanged");
Console.WriteLine($"   ToUpperInvariant()  : {upper}");
Console.WriteLine($"   Trim()              : \"{trimmed}\"");
Console.WriteLine($"   Replace(\"inv\", ...) : {replaced}");
Console.WriteLine();

Console.WriteLine("2. methods that find nothing to do return the SAME object");
string alreadyTrimmed = "tight";
Console.WriteLine($"   ReferenceEquals(s, s.Trim())        : {ReferenceEquals(alreadyTrimmed, alreadyTrimmed.Trim())}");
Console.WriteLine($"   ReferenceEquals(s, s.Replace(\"z\",\"\")): {ReferenceEquals(alreadyTrimmed, alreadyTrimmed.Replace("z", ""))}");
Console.WriteLine("   That is an optimisation, not a guarantee. Never rely on it.");
Console.WriteLine();

Console.WriteLine("3. null, empty, and whitespace are three different things");
string? nothing = null;
string empty = string.Empty;
string blank = "   ";

Report("null", nothing);
Report("string.Empty", empty);
Report("\"   \"", blank);
Console.WriteLine();

Console.WriteLine("4. Substring allocates; slicing with a span does not");
string csv = "INV-2026-0042,144.00,GBP";

long before = GC.GetAllocatedBytesForCurrentThread();
string field = csv.Substring(0, 13);
long afterSubstring = GC.GetAllocatedBytesForCurrentThread();

ReadOnlySpan<char> slice = csv.AsSpan(0, 13);
long afterSpan = GC.GetAllocatedBytesForCurrentThread();

Console.WriteLine($"   Substring(0, 13)  -> \"{field}\"  allocated {afterSubstring - before} bytes");
Console.WriteLine($"   AsSpan(0, 13)     -> \"{slice}\"  allocated {afterSpan - afterSubstring} bytes");
Console.WriteLine();

Console.WriteLine("5. a big string goes on the Large Object Heap, same as any object");
int boundary = -1;
for (int chars = 42_000; chars <= 42_600; chars++)
{
    string candidate = new string('x', chars);
    if (GC.GetGeneration(candidate) == 2) { boundary = chars; break; }
}
Console.WriteLine($"   first string on the LOH : {boundary:N0} chars");
Console.WriteLine($"   payload bytes           : {boundary * 2:N0}");
long rawSize = (boundary * 2) + 22;                 // 16-byte header + 4 length + 2 terminator
long padded = ((rawSize + 7) / 8) * 8;              // objects are 8-byte aligned
Console.WriteLine($"   + 22-byte overhead      : {rawSize:N0}");
Console.WriteLine($"   rounded to 8-byte align : {padded:N0}   <-- exactly the 85,000 threshold");
Console.WriteLine("   A 42,000-character string is about 21 A4 pages of text, or one");
Console.WriteLine("   medium JSON document. Building those per request is an LOH problem.");

static void Report(string label, string? value)
{
    Console.WriteLine(
        $"   {label,-14} IsNullOrEmpty={string.IsNullOrEmpty(value),-5} " +
        $"IsNullOrWhiteSpace={string.IsNullOrWhiteSpace(value),-5} Length={(value is null ? "n/a" : value.Length.ToString(CultureInfo.InvariantCulture))}");
}
