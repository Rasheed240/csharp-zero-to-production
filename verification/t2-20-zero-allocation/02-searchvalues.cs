// 02-searchvalues.cs — SearchValues<T>, and the allocation hiding inside
// IndexOfAny(params char[]).
//
// Run:  dotnet run 02-searchvalues.cs -c Release
//
// EXACT vs RATIO: allocation figures are exact and deterministic. Times are
// ratios against the stated baseline and vary between runs.

using System.Buffers;
using System.Diagnostics;

const string Haystack =
    "INV-2026-0004821;GBP;0000001234502026-03-14;CUSTOMER-000512;" +
    "settlement batch 44, no exceptions raised, cleared value date 2026-03-16";

const int Iterations = 2_000_000;

Console.WriteLine($"Haystack length : {Haystack.Length}");
Console.WriteLine($"Iterations      : {Iterations:N0}");
Console.WriteLine();

TheHiddenAllocation();
Comparison();
ByteVersion();
WhenItIsNotWorthIt();

// ---------------------------------------------------------------------------
static void TheHiddenAllocation()
{
    Console.WriteLine("1. The allocation nobody sees");
    Console.WriteLine();

    Console.WriteLine("   text.IndexOfAny(';', ',', ':')");
    Console.WriteLine();
    Console.WriteLine("   That overload takes params char[]. A NEW ARRAY is allocated on");
    Console.WriteLine("   every call unless the compiler can cache it - and for three or");
    Console.WriteLine("   more characters on string.IndexOfAny, it cannot.");
    Console.WriteLine();

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    long before = GC.GetTotalAllocatedBytes(precise: true);

    long sink = 0;
    for (int i = 0; i < 200_000; i++)
    {
        sink += Haystack.IndexOfAny(new[] { ';', ',', ':' });
    }

    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine($"   200,000 calls with an explicit array:");
    Console.WriteLine($"     allocated : {allocated:N0} bytes ({allocated / 200_000.0:F0} per call)");
    Console.WriteLine($"   (sink {sink})");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Comparison()
{
    Console.WriteLine("2. Four ways to find the first delimiter");
    Console.WriteLine();

    // SearchValues is built ONCE and reused. That is the whole design: the
    // expensive analysis of which algorithm to use happens at construction.
    SearchValues<char> delimiters = SearchValues.Create(";,:");
    char[] delimiterArray = { ';', ',', ':' };
    var delimiterSet = new HashSet<char> { ';', ',', ':' };

    Console.WriteLine("   approach                        allocated       time      index");
    Console.WriteLine("   --------                        ---------       ----      -----");

    Run("SearchValues.IndexOfAny     ", () => Haystack.AsSpan().IndexOfAny(delimiters));
    Run("span.IndexOfAny(a, b, c)    ", () => Haystack.AsSpan().IndexOfAny(';', ',', ':'));
    Run("string.IndexOfAny(char[])   ", () => Haystack.IndexOfAny(delimiterArray));
    Run("hand-written HashSet loop   ", () =>
    {
        for (int i = 0; i < Haystack.Length; i++)
        {
            if (delimiterSet.Contains(Haystack[i]))
            {
                return i;
            }
        }

        return -1;
    });

    Console.WriteLine();
    Console.WriteLine("   All four find the same index, which is the first thing to check.");
    Console.WriteLine();
    Console.WriteLine("   The array overloads allocate nothing HERE because the array is");
    Console.WriteLine("   hoisted into a local outside the loop. Written inline - which is");
    Console.WriteLine("   how it usually appears - it allocates per call, as section 1 shows.");
    Console.WriteLine();
    Console.WriteLine("   SearchValues wins on time because construction chose a strategy:");
    Console.WriteLine("   for a small ASCII set it builds a bitmap and vectorises the scan.");
    Console.WriteLine("   The HashSet loop is the honest baseline for 'what you would write");
    Console.WriteLine("   without knowing about any of this'.");
    Console.WriteLine();

    static void Run(string label, Func<int> body)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        long before = GC.GetTotalAllocatedBytes(precise: true);
        var sw = Stopwatch.StartNew();

        int last = 0;
        for (int i = 0; i < Iterations; i++)
        {
            last = body();
        }

        sw.Stop();
        long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

        Console.WriteLine($"   {label}   {allocated,9:N0} B   {sw.Elapsed.TotalMilliseconds,6:F0} ms   {last,5}");
    }
}

// ---------------------------------------------------------------------------
static void ByteVersion()
{
    Console.WriteLine("3. The same thing on UTF-8 bytes");
    Console.WriteLine();

    ReadOnlySpan<byte> utf8 = "INV-2026-0004821;GBP;123450"u8;
    SearchValues<byte> byteDelimiters = SearchValues.Create(";,:"u8);

    Console.WriteLine($"   \"INV-2026-0004821;GBP;123450\"u8");
    Console.WriteLine($"   IndexOfAny(SearchValues<byte>) : {utf8.IndexOfAny(byteDelimiters)}");
    Console.WriteLine();
    Console.WriteLine("   SearchValues.Create has a byte overload, so a parser reading from");
    Console.WriteLine("   a socket never needs to decode to chars to find its delimiters.");
    Console.WriteLine();

    // ContainsAny and IndexOfAnyExcept are the other two worth knowing.
    SearchValues<char> digits = SearchValues.Create("0123456789");

    foreach (string candidate in new[] { "0000123450", "00001A3450", "" })
    {
        bool allDigits = candidate.Length > 0 &&
            candidate.AsSpan().IndexOfAnyExcept(digits) < 0;
        Console.WriteLine($"   \"{candidate,-10}\" is all digits : {allDigits}");
    }

    Console.WriteLine();
    Console.WriteLine("   IndexOfAnyExcept is the validation primitive: it answers 'is every");
    Console.WriteLine("   character in this set' without a loop and without allocating. Note");
    Console.WriteLine("   the empty-string case has to be handled separately, because a span");
    Console.WriteLine("   with nothing in it has nothing outside the set either.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhenItIsNotWorthIt()
{
    Console.WriteLine("4. When SearchValues is the wrong tool");
    Console.WriteLine();

    SearchValues<char> single = SearchValues.Create(";");

    Console.WriteLine("   approach                        time");
    Console.WriteLine("   --------                        ----");

    Time("IndexOf(';')                ", () => Haystack.AsSpan().IndexOf(';'));
    Time("IndexOfAny(SearchValues(\";\"))", () => Haystack.AsSpan().IndexOfAny(single));

    Console.WriteLine();
    Console.WriteLine("   For ONE character, plain IndexOf is already vectorised and");
    Console.WriteLine("   SearchValues adds an indirection for nothing.");
    Console.WriteLine();
    Console.WriteLine("   The rule: SearchValues is for a set of THREE OR MORE values that");
    Console.WriteLine("   you search for repeatedly. It must be built once - a static");
    Console.WriteLine("   readonly field - because construction is the expensive part.");
    Console.WriteLine();
    Console.WriteLine("   Creating one inside the method you call in a loop is strictly");
    Console.WriteLine("   worse than not using it at all.");

    static void Time(string label, Func<int> body)
    {
        var sw = Stopwatch.StartNew();
        int last = 0;
        for (int i = 0; i < Iterations; i++)
        {
            last = body();
        }

        sw.Stop();
        Console.WriteLine($"   {label}   {sw.Elapsed.TotalMilliseconds,6:F0} ms   (index {last})");
    }
}
