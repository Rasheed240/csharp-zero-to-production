// Demo 3 — a string cannot be changed, so every "append" builds a new one.
// Run with: dotnet run -c Release 03-building-strings.cs
using System.Diagnostics;
using System.Globalization;
using System.Text;

const char Dash = (char)45;   // -

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. concatenating in a loop is quadratic");
Console.WriteLine($"   {"lines",8} {"+= in a loop",16} {"StringBuilder",16}");
Console.WriteLine("   " + new string('-', 44));

foreach (int lines in new[] { 5_000, 10_000, 20_000, 40_000 })
{
    (long concatMs, long concatBytes) = MeasureConcat(lines);
    (long builderMs, long builderBytes) = MeasureBuilder(lines);

    Console.WriteLine(
        $"   {lines,8:N0} {concatMs,7:N0} ms {concatBytes / 1024.0 / 1024.0,6:F1} MB" +
        $" {builderMs,7:N0} ms {builderBytes / 1024.0 / 1024.0,6:F1} MB");
}
Console.WriteLine("   Doubling the line count roughly quadruples both the time and the garbage.");
Console.WriteLine();

Console.WriteLine("2. for a FIXED, small number of pieces the picture is different");
const int Calls = 1_000_000;
string a = "AAA", b = "BBB", c = "CCC", d = "DDD";
long sink = 0;

Console.WriteLine($"   {Calls:N0} calls, bytes allocated per call:");
Console.WriteLine();

Bench("a + b                    (2 pieces)", () => { string s = a + b; return s.Length; });
Bench("a + b + c                (3 pieces)", () => { string s = a + b + c; return s.Length; });
Bench("a + b + c + d            (4 pieces)", () => { string s = a + b + c + d; return s.Length; });
Bench("a + \"-\" + b + \"-\" + c    (5 pieces)", () => { string s = a + "-" + b + "-" + c; return s.Length; });
Bench("string.Concat(a,\"-\",b,\"-\",c)", () => { string s = string.Concat(a, "-", b, "-", c); return s.Length; });
Bench("$\"{a}-{b}-{c}\"", () => { string s = $"{a}-{b}-{c}"; return s.Length; });
Bench("StringBuilder for the same", () =>
{
    StringBuilder sb = new StringBuilder();
    sb.Append(a).Append(Dash).Append(b).Append(Dash).Append(c);
    string s = sb.ToString();
    return s.Length;
});

Console.WriteLine();
Console.WriteLine("   Up to FOUR pieces, + calls a direct String.Concat overload: one");
Console.WriteLine("   allocation, the result string. At FIVE it needs String.Concat(string[]),");
Console.WriteLine("   so it also allocates a 5-element array.");
Console.WriteLine();
Console.WriteLine("   Writing string.Concat(...) explicitly avoids that: since .NET 9 there is");
Console.WriteLine("   a params ReadOnlySpan<string> overload, which the compiler satisfies from");
Console.WriteLine("   the stack. Interpolation is flat because it uses an interpolated string");
Console.WriteLine("   handler with a pooled buffer.");
Console.WriteLine();
Console.WriteLine("   StringBuilder is the WORST choice here: it allocates a builder and an");
Console.WriteLine("   internal buffer before producing the same string.");
Console.WriteLine($"   (checksum {sink})");
Console.WriteLine();

void Bench(string label, Func<int> build)
{
    for (int i = 0; i < 1_000; i++) { sink += build(); }   // warm up
    long before = GC.GetAllocatedBytesForCurrentThread();
    for (int i = 0; i < Calls; i++) { sink += build(); }
    long after = GC.GetAllocatedBytesForCurrentThread();
    Console.WriteLine($"     {label,-38} {(after - before) / (double)Calls,6:F1}");
}

Console.WriteLine("3. does pre-sizing a StringBuilder help? measured, not assumed");
const int Rows = 20_000;

StringBuilder probe = new StringBuilder();
for (int i = 0; i < Rows; i++) { probe.Append("INV-").Append(i).Append(";").Append('\n'); }
int actualChars = probe.Length;

Console.WriteLine($"   the finished string is {actualChars:N0} chars ({actualChars * 2 / 1024.0:F0} KB)");
Console.WriteLine();
Console.WriteLine($"   {"capacity given",16} {"allocated",12}");
Console.WriteLine("   " + new string(Dash, 30));

foreach (int capacity in new[] { 0, actualChars / 2, actualChars, actualChars * 2, Rows * 24 })
{
    long bytes = MeasureAlloc(() => BuildReport(Rows, capacity));
    string label = capacity == 0 ? "none" : capacity.ToString("N0", CultureInfo.InvariantCulture);
    Console.WriteLine($"   {label,16} {bytes / 1024.0,9:F0} KB");
}

Console.WriteLine();
Console.WriteLine("   Pre-sizing barely helps, and OVER-sizing costs more than not sizing at all.");
Console.WriteLine("   StringBuilder keeps a linked list of chunks rather than one buffer it");
Console.WriteLine("   doubles, so growing does not copy what it already holds. This is the");
Console.WriteLine("   opposite of List<T>, where pre-sizing removes real copying.");

static (long Ms, long Bytes) MeasureConcat(int lines)
{
    long before = GC.GetAllocatedBytesForCurrentThread();
    Stopwatch sw = Stopwatch.StartNew();

    string report = string.Empty;
    for (int i = 0; i < lines; i++)
    {
        report += "INV-" + i + ";";      // a brand-new string every time
    }

    sw.Stop();
    long after = GC.GetAllocatedBytesForCurrentThread();
    if (report.Length == 0) { Console.WriteLine("unreachable"); }
    return (sw.ElapsedMilliseconds, after - before);
}

static (long Ms, long Bytes) MeasureBuilder(int lines)
{
    long before = GC.GetAllocatedBytesForCurrentThread();
    Stopwatch sw = Stopwatch.StartNew();

    StringBuilder builder = new StringBuilder();
    for (int i = 0; i < lines; i++)
    {
        builder.Append("INV-").Append(i).Append(';');
    }
    string report = builder.ToString();

    sw.Stop();
    long after = GC.GetAllocatedBytesForCurrentThread();
    if (report.Length == 0) { Console.WriteLine("unreachable"); }
    return (sw.ElapsedMilliseconds, after - before);
}

static long MeasureAlloc(Action work)
{
    work();   // warm up
    long before = GC.GetAllocatedBytesForCurrentThread();
    work();
    return GC.GetAllocatedBytesForCurrentThread() - before;
}

static void BuildReport(int rows, int capacity)
{
    StringBuilder builder = capacity > 0 ? new StringBuilder(capacity) : new StringBuilder();
    for (int i = 0; i < rows; i++)
    {
        builder.Append("INV-").Append(i).Append(";\n");
    }
    string result = builder.ToString();
    if (result.Length == 0) { Console.WriteLine("unreachable"); }
}
