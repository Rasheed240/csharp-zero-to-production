// Worked solutions from exercises 1, 2 and 4, verified.
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// --- Exercise 1 -----------------------------------------------------------
Console.WriteLine("Exercise 1");
string a = "INV-1";
string b = "INV-1";
Console.WriteLine($"  (a) ReferenceEquals(a, b)     -> {ReferenceEquals(a, b)}");

string prefix = "INV-";
string built = prefix + "1";
Console.WriteLine($"  (b) ReferenceEquals(built, a) -> {ReferenceEquals(built, a)}");
Console.WriteLine($"      built == a                -> {built == a}");

string s = "hello";
string t = s.ToUpperInvariant();
Console.WriteLine($"  (c) s after ToUpperInvariant  -> {s}   (t = {t})");
Console.WriteLine($"  (d) emoji Length              -> {"\U0001F600".Length}");
Console.WriteLine($"  (e) \"Ledger\" == \"ledger\"      -> {"Ledger" == "ledger"}");
Console.WriteLine($"      OrdinalIgnoreCase         -> {string.Equals("Ledger", "ledger", StringComparison.OrdinalIgnoreCase)}");
Console.WriteLine();

// --- Exercise 2: Usernames ------------------------------------------------
Console.WriteLine("Exercise 2 - Usernames.TryCanonicalise");
foreach (string candidate in new[] { "  Ledger  ", "ADMIN", "ab", "root", "Ada\U0001F600Lovelace" })
{
    bool ok = Usernames.TryCanonicalise(candidate, out string canonical);
    Console.WriteLine($"  {"\"" + candidate + "\"",-24} -> {ok,-5} \"{canonical}\"");
}

// The Turkish check: the fixed version must reject ADMIN in every culture.
foreach (string culture in new[] { "en-GB", "tr-TR" })
{
    CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
    bool ok = Usernames.TryCanonicalise("ADMIN", out _);
    Console.WriteLine($"  culture {culture,-6} accepts \"ADMIN\"? {ok}");
}
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine($"  CacheKeyFor(\"ada\") -> {Usernames.CacheKeyFor("ada")[..24]}...");
Console.WriteLine("  (stable across runs, unlike GetHashCode)");
Console.WriteLine();

// --- Exercise 4: SplitFields ---------------------------------------------
Console.WriteLine("Exercise 4 - SplitFields");
Split("INV-1,144.00,GBP", 8);
Split("a,b,", 8);
Split("single", 8);
Split("", 8);
Split(",,", 8);
Split("a,b,c,d", 2);          // buffer too small
Console.WriteLine();

// Parsing straight from the span, with no intermediate strings.
ReadOnlySpan<char> line = "INV-1,144.00,GBP";
Span<Range> fields = stackalloc Range[8];
int count = SplitFields(line, fields);

decimal amount = decimal.Parse(line[fields[1]], CultureInfo.InvariantCulture);
bool isGbp = line[fields[2]].SequenceEqual("GBP");
Console.WriteLine($"  parsed amount from span -> {amount}");
Console.WriteLine($"  currency is GBP         -> {isGbp}");
Console.WriteLine();

// Allocation comparison against string.Split.
const int Lines = 200_000;
string sample = "INV-1,144.00,GBP";

long beforeSplit = GC.GetAllocatedBytesForCurrentThread();
long sink = 0;
for (int i = 0; i < Lines; i++)
{
    string[] parts = sample.Split(',');
    sink += parts.Length;
}
long splitBytes = GC.GetAllocatedBytesForCurrentThread() - beforeSplit;

// The stackalloc lives OUTSIDE the loop. Stack memory is not released until
// the method returns, so allocating inside a 200,000-iteration loop exhausts
// the stack - the compiler warns CA2014, and it really does crash.
Span<Range> reusable = stackalloc Range[8];
long beforeSpan = GC.GetAllocatedBytesForCurrentThread();
for (int i = 0; i < Lines; i++)
{
    sink += SplitFields(sample, reusable);
}
long spanBytes = GC.GetAllocatedBytesForCurrentThread() - beforeSpan;

Console.WriteLine($"  {Lines:N0} lines parsed:");
Console.WriteLine($"    string.Split(',') -> {splitBytes / 1024.0 / 1024.0,6:F1} MB  ({splitBytes / (double)Lines:F0} bytes/line)");
Console.WriteLine($"    SplitFields       -> {spanBytes / 1024.0 / 1024.0,6:F1} MB  ({spanBytes / (double)Lines:F0} bytes/line)");
Console.WriteLine($"  (checksum {sink})");

static void Split(string line, int bufferSize)
{
    Span<Range> fields = new Range[bufferSize];
    int count = SplitFields(line, fields);

    if (count < 0)
    {
        Console.WriteLine($"  {"\"" + line + "\"",-22} -> buffer too small (-1)");
        return;
    }

    List<string> shown = new List<string>();
    for (int i = 0; i < count; i++)
    {
        shown.Add("\"" + line.AsSpan()[fields[i]].ToString() + "\"");
    }
    Console.WriteLine($"  {"\"" + line + "\"",-22} -> {count} fields: {string.Join(" ", shown)}");
}

static int SplitFields(ReadOnlySpan<char> line, Span<Range> fields)
{
    if (fields.Length == 0)
    {
        return 0;
    }

    int count = 0;
    int start = 0;

    for (int i = 0; i < line.Length; i++)
    {
        if (line[i] != ',')
        {
            continue;
        }

        if (count == fields.Length)
        {
            return -1;      // more fields than the caller made room for
        }

        fields[count++] = new Range(start, i);
        start = i + 1;
    }

    if (count == fields.Length)
    {
        return -1;
    }

    fields[count++] = new Range(start, line.Length);
    return count;
}

public static class Usernames
{
    private static readonly HashSet<string> Reserved =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "admin", "root", "system" };

    public static bool TryCanonicalise(string? input, out string canonical)
    {
        canonical = string.Empty;

        if (string.IsNullOrWhiteSpace(input))
        {
            return false;
        }

        string trimmed = input.Trim().Normalize(NormalizationForm.FormC);
        string lowered = trimmed.ToLowerInvariant();

        int graphemes = 0;
        TextElementEnumerator enumerator = StringInfo.GetTextElementEnumerator(lowered);
        while (enumerator.MoveNext())
        {
            graphemes++;
        }

        if (graphemes < 3 || graphemes > 20)
        {
            return false;
        }

        if (Reserved.Contains(lowered))
        {
            return false;
        }

        canonical = lowered;
        return true;
    }

    public static string CacheKeyFor(string username)
    {
        ArgumentNullException.ThrowIfNull(username);

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(username));
        return "user:" + Convert.ToHexString(hash);
    }
}
