// Demo 2 — a string is a length plus a run of 16-bit code units. Length is not
// the number of characters a human sees.
using System.Globalization;
using System.Text;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. a char is 16 bits, and Length counts code units");
Console.WriteLine($"   sizeof(char)                 : {sizeof(char)} bytes");
Console.WriteLine();

(string Text, string Description)[] samples =
{
    ("abc", "three plain ASCII letters"),
    ("café", "e-acute, one code point"),
    ("Å", "A + combining ring (looks like one letter)"),
    ("\U0001F600", "grinning face emoji"),
    ("\U0001F1EC\U0001F1E7", "GB flag: two regional indicators"),
    ("\U0001F468‍\U0001F4BB", "man technologist: 3 code points + joiner")
};

Console.WriteLine($"   {"text",-14} {"Length",7} {"runes",6} {"graphemes",10}  description");
Console.WriteLine("   " + new string('-', 72));

foreach ((string text, string description) in samples)
{
    int runes = 0;
    foreach (Rune _ in text.EnumerateRunes()) { runes++; }

    int graphemes = 0;
    StringInfo info = new StringInfo(text);
    TextElementEnumerator enumerator = StringInfo.GetTextElementEnumerator(text);
    while (enumerator.MoveNext()) { graphemes++; }

    Console.WriteLine($"   {text,-14} {text.Length,7} {runes,6} {graphemes,10}  {description}");
}

Console.WriteLine();
Console.WriteLine("   Length  = UTF-16 code units (what indexing and Substring use)");
Console.WriteLine("   runes   = Unicode code points");
Console.WriteLine("   graphemes = what a person would call 'one character'");
Console.WriteLine();

Console.WriteLine("2. so slicing by Length can split a character in half");
string emoji = "\U0001F600";
Console.WriteLine($"   emoji.Length            : {emoji.Length}");
Console.WriteLine($"   emoji[0] is a surrogate : {char.IsHighSurrogate(emoji[0])}");
Console.WriteLine($"   emoji[1] is a surrogate : {char.IsLowSurrogate(emoji[1])}");

string half = emoji.Substring(0, 1);
Console.WriteLine($"   Substring(0, 1) length  : {half.Length}   renders as: \"{half}\"  (broken)");
Console.WriteLine();

Console.WriteLine("3. truncating user text safely");
string name = "Ada \U0001F600 Lovelace";
Console.WriteLine($"   original            : \"{name}\" (Length {name.Length})");
Console.WriteLine($"   naive Substring(0,6): \"{name.Substring(0, 6)}\"   <-- may split a pair");
Console.WriteLine($"   grapheme-safe       : \"{TruncateByGraphemes(name, 5)}\"");
Console.WriteLine();

Console.WriteLine("4. bytes on the wire are a different count again");
foreach (string text in new[] { "abc", "café", "\U0001F600" })
{
    Console.WriteLine(
        $"   \"{text}\"  Length={text.Length}  UTF-8 bytes={Encoding.UTF8.GetByteCount(text)}" +
        $"  UTF-16 bytes={Encoding.Unicode.GetByteCount(text)}");
}
Console.WriteLine("   A database column of 'n characters' usually means bytes. Check which.");

static string TruncateByGraphemes(string text, int maxGraphemes)
{
    TextElementEnumerator enumerator = StringInfo.GetTextElementEnumerator(text);
    StringBuilder builder = new StringBuilder();
    int taken = 0;

    while (enumerator.MoveNext() && taken < maxGraphemes)
    {
        builder.Append(enumerator.GetTextElement());
        taken++;
    }
    return builder.ToString();
}
