// Demo 3 — a compiled assembly is not a locked box. String literals sit in it
// in plain sight. This program finds its own hard-coded "secret" inside its own
// compiled file, using nothing but a byte search.
using System.Reflection;
using System.Text;

// Pretend someone thought this was safe because "it gets compiled".
const string ApiKey = "sk_live_LEDGER_51H8xQ2vB";

// Built from BaseDirectory rather than Assembly.Location, which returns an
// empty string when an app is published as a single file.
string assemblyName = Assembly.GetExecutingAssembly().GetName().Name!;
string assemblyPath = Path.Combine(AppContext.BaseDirectory, assemblyName + ".dll");

Console.WriteLine($"compiled assembly: {Path.GetFileName(assemblyPath)}");
Console.WriteLine($"size on disk     : {new FileInfo(assemblyPath).Length:N0} bytes");
Console.WriteLine();

byte[] fileBytes = File.ReadAllBytes(assemblyPath);

// .NET stores string literals as UTF-16 in the assembly's user-string heap.
byte[] needle = Encoding.Unicode.GetBytes(ApiKey);
int at = IndexOf(fileBytes, needle);

Console.WriteLine(at >= 0
    ? $"found the API key at byte offset {at} of the compiled file"
    : "not found (unexpected)");
Console.WriteLine();

// Recover it the way an attacker would: read the bytes back out.
if (at >= 0)
{
    string recovered = Encoding.Unicode.GetString(fileBytes, at, needle.Length);
    Console.WriteLine($"recovered from the binary: {recovered}");
}

Console.WriteLine();
Console.WriteLine("Every other literal in this file is equally readable:");
foreach (string found in FindUnicodeStrings(fileBytes, minimumLength: 12).Take(6))
{
    Console.WriteLine($"  {found}");
}

static int IndexOf(byte[] haystack, byte[] needle)
{
    for (int i = 0; i + needle.Length <= haystack.Length; i++)
    {
        bool match = true;
        for (int j = 0; j < needle.Length; j++)
        {
            if (haystack[i + j] != needle[j])
            {
                match = false;
                break;
            }
        }
        if (match)
        {
            return i;
        }
    }
    return -1;
}

// Pull out runs of printable ASCII stored as UTF-16 (every second byte zero).
static IEnumerable<string> FindUnicodeStrings(byte[] bytes, int minimumLength)
{
    StringBuilder current = new StringBuilder();
    for (int i = 0; i + 1 < bytes.Length; i += 2)
    {
        byte low = bytes[i];
        byte high = bytes[i + 1];
        if (high == 0 && low >= 0x20 && low < 0x7F)
        {
            current.Append((char)low);
        }
        else
        {
            if (current.Length >= minimumLength)
            {
                yield return current.ToString();
            }
            current.Clear();
        }
    }
    if (current.Length >= minimumLength)
    {
        yield return current.ToString();
    }
}
