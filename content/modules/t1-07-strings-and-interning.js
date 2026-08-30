/* ============================================================================
   Track 1, Module 7 — Strings, Immutability, and Interning
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-07-strings-and-interning/.
   ========================================================================= */

CSPREP.module({
  id: "t1-07-strings-and-interning",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "A string is a fixed run of 16-bit code units that can never be changed. That gives you " +
    "safe sharing and free interning, and it costs you a new allocation for every edit — plus " +
    "a Length that does not count characters and a comparison that changes answer by country.",
  terms: [
    "string", "immutable", "UTF-16", "code unit", "code point", "rune", "grapheme",
    "surrogate pair", "StringBuilder", "string interning", "intern pool",
    "ordinal comparison", "culture-sensitive comparison", "invariant culture",
    "Unicode normalisation", "hash randomisation", "string.Empty"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Four bug reports, all involving text, all from services that work perfectly in
  development.</p>

  <p>An export job that produces a 40,000-line report takes almost four seconds of pure CPU and
  allocates <strong>fourteen gigabytes</strong> of memory to produce a file that is a few
  megabytes. Nothing is leaking; it is all collected. The code is one loop with one
  <code>+=</code> in it.</p>

  <p>A user in Istanbul reports that the username <code>ADMIN</code> was accepted during
  registration, on a service whose blocklist explicitly contains <code>admin</code>. The check
  is a lowercase comparison. It works on every machine the team has.</p>

  <p>A field limited to 30 characters rejects a name that is visibly 12 characters long. The
  user's name contains an emoji.</p>

  <p>A distributed cache starts missing on every lookup after a deployment. The cache key was
  derived from a string's hash code, and the two services computing it now disagree — even
  though both run identical code.</p>

  <p>All four come from the same two facts: <strong>a string is a fixed run of 16-bit code units
  that can never be changed</strong>, and <strong>text has meaning that depends on human
  language</strong>. Everything in this module follows from those.</p>
</section>

<section id="what-a-string-is">
  <h2>What a string actually is</h2>

  <p>Every term is defined before it is used again.</p>

  <p class="define"><span class="define__term">String</span> A sequence of characters, held as a
  length plus a run of 16-bit values laid end to end. In C# it is <code>string</code>, and it is
  a reference type — the variable holds a direction to the data on the heap.</p>

  <p class="define"><span class="define__term">Immutable</span> Unable to be changed after
  creation. Every method that appears to modify a string returns a <em>new</em> string and leaves
  the original untouched.</p>

  <p class="define"><span class="define__term">UTF-16</span> The encoding .NET uses in memory:
  each character is stored as one or two 16-bit values.</p>

  <p class="define"><span class="define__term">Code unit</span> One of those 16-bit values. A
  <code>char</code> in C# is exactly one code unit, and <code>string.Length</code> counts code
  units — not characters.</p>

  <p>Immutability is the design decision everything else hangs off. It buys three things:</p>

  <ul>
    <li><strong>Safe sharing.</strong> Handing a string to another method, thread, or object
    costs nothing and risks nothing, because nobody can change it underneath you. Compare that
    with an array, which is fully writable by anyone holding it.</li>
    <li><strong>A safe hash code.</strong> A value used as a dictionary key must not change while
    it is in the dictionary. Immutability guarantees that for free.</li>
    <li><strong>Interning.</strong> Two identical strings can be the same object, because there
    is no way to tell them apart or to change one without the other.</li>
  </ul>

  <p>And it costs one thing, which is the source of half this module: <strong>every edit
  allocates.</strong></p>

  <div class="callout callout--note">
    <h4>The analogy, and where it breaks</h4>
    <p>A string is a <strong>printed page</strong>, not a whiteboard. To "change" a word you
    reprint the page; the original stays exactly as it was. Anyone you have already given a copy
    to still sees the old text, which is a feature — nothing they hold can shift under them.</p>
    <p>Where the analogy breaks: reprinting a page is visibly expensive, so nobody would do it
    in a loop by accident. In code the reprint is invisible — <code>report += line;</code> looks
    like appending, and the fact that it built an entire new page is not written anywhere. That
    invisibility is exactly why the four-second, fourteen-gigabyte export exists.</p>
    <p>The analogy also breaks on counting. A printed page has a countable number of letters. A
    string's <code>Length</code> counts storage slots, and a single visible character can occupy
    up to five of them.</p>
  </div>
</section>

<section id="immutability">
  <h2>Immutability in practice</h2>

<pre data-lang="csharp" data-net="10" data-title="01-string-basics.cs"><code>string reference = "inv-2026-0042";
string upper = reference.ToUpperInvariant();
string trimmed = "  spaced  ".Trim();
string replaced = reference.Replace("inv", "receipt");

Console.WriteLine($"original            : {reference}");
Console.WriteLine($"ToUpperInvariant()  : {upper}");
Console.WriteLine($"Trim()              : \\"{trimmed}\\"");
Console.WriteLine($"Replace(\\"inv\\", ...) : {replaced}");</code></pre>

<pre data-lang="console" data-title="Output"><code>original            : inv-2026-0042   &lt;-- unchanged
ToUpperInvariant()  : INV-2026-0042
Trim()              : "spaced"
Replace("inv", ...) : receipt-2026-0042</code></pre>

  <p>The compiler enforces this. There is no way to write into a string:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="06-compile-error-probe.cs"><code>reference[0] = 'X';
reference.Length = 5;</code></pre>

<pre data-lang="console" data-title="Compiler output"><code>error CS0200: Property or indexer 'string.this[int]' cannot be assigned to -- it is read only
error CS0200: Property or indexer 'string.Length' cannot be assigned to -- it is read only</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: a method with nothing to do may return the same object</h4>
<pre data-lang="console" data-title="Output"><code>ReferenceEquals(s, s.Trim())         : True
ReferenceEquals(s, s.Replace("z","")): True</code></pre>
    <p>When <code>Trim</code> finds no whitespace it returns the original object rather than
    allocating an identical copy. That is an optimisation the framework is free to make or not,
    and it is <strong>not a guarantee</strong>. Never write code that depends on whether two
    strings are the same object — compare values, never references.</p>
  </div>

  <h3>Three things that are not the same</h3>

<pre data-lang="console" data-title="Output"><code>null           IsNullOrEmpty=True  IsNullOrWhiteSpace=True  Length=n/a
string.Empty   IsNullOrEmpty=True  IsNullOrWhiteSpace=True  Length=0
"   "          IsNullOrEmpty=False IsNullOrWhiteSpace=True  Length=3</code></pre>

  <p><code>null</code> means "no string at all" and throws if you call anything on it.
  <code>string.Empty</code> is a real string of length zero. <code>"   "</code> is three
  characters that happen to be invisible.</p>

  <p>For validating user input, <code>IsNullOrWhiteSpace</code> is almost always the one you
  want — a form field containing three spaces is empty as far as a human is concerned. Prefer
  returning <code>string.Empty</code> over <code>null</code> for the same reason
  <a href="#/m/t1-06-arrays">Arrays</a> recommends <code>Array.Empty&lt;T&gt;()</code>: it
  removes a null check from every caller.</p>
</section>

<section id="utf16">
  <h2>Why <code>Length</code> is not the number of characters</h2>

  <p>This is the third incident from the opening, and it catches nearly everyone.</p>

  <p class="define"><span class="define__term">Code point</span> One Unicode character in the
  abstract — the thing that has a name and a number. There are about 150,000 of them.</p>

  <p class="define"><span class="define__term">Surrogate pair</span> Two 16-bit code units used
  together to store a code point too large for one. Every emoji is stored this way.</p>

  <p class="define"><span class="define__term">Rune</span> .NET's type for a single code point,
  <code>System.Text.Rune</code>. Iterating runes gives code points rather than code units.</p>

  <p class="define"><span class="define__term">Grapheme</span> What a person would call one
  character — possibly several code points combined, such as a letter plus an accent, or a flag,
  or an emoji with a skin tone.</p>

  <p>Three different counts, measured:</p>

<pre data-lang="console" data-title="dotnet run 02-utf16-internals.cs"><code>text            Length  runes  graphemes  description
------------------------------------------------------------------------
abc                  3      3          3  three plain ASCII letters
café                 4      4          4  e-acute, one code point
Å                    2      2          1  A + combining ring (looks like one letter)
😀                    2      1          1  grinning face emoji
🇬🇧                   4      2          1  GB flag: two regional indicators
👨‍💻                   5      3          1  man technologist: 3 code points + joiner</code></pre>

  <p>The last row is the one to remember. A single visible character —
  a person at a laptop — is <strong>five</strong> as far as <code>Length</code> is concerned.
  A "30 character" limit enforced with <code>Length</code> rejects a six-emoji name.</p>

  <p>Worse than rejecting is splitting:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="02-utf16-internals.cs"><code>string emoji = "\\U0001F600";
Console.WriteLine($"emoji.Length            : {emoji.Length}");
Console.WriteLine($"emoji[0] is a surrogate : {char.IsHighSurrogate(emoji[0])}");

string half = emoji.Substring(0, 1);
Console.WriteLine($"Substring(0, 1) length  : {half.Length}   renders as: \\"{half}\\"");</code></pre>

<pre data-lang="console" data-title="Output"><code>emoji.Length            : 2
emoji[0] is a surrogate : True
Substring(0, 1) length  : 1   renders as: "&#65533;"  (broken)</code></pre>

  <p>Cutting a string at an arbitrary index can slice a character in half, producing a value that
  is not valid text. It will round-trip through your database, appear as a replacement character
  in a browser, and fail validation somewhere far from where it was created.</p>

  <p>Truncating safely means walking graphemes:</p>

<pre data-lang="csharp" data-net="10" data-title="02-utf16-internals.cs"><code>static string TruncateByGraphemes(string text, int maxGraphemes)
{
    TextElementEnumerator enumerator = StringInfo.GetTextElementEnumerator(text);
    StringBuilder builder = new StringBuilder();
    int taken = 0;

    while (enumerator.MoveNext() &amp;&amp; taken &lt; maxGraphemes)
    {
        builder.Append(enumerator.GetTextElement());
        taken++;
    }
    return builder.ToString();
}</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: the byte count is a fourth number again</h4>
<pre data-lang="console" data-title="Output"><code>"abc"  Length=3  UTF-8 bytes=3  UTF-16 bytes=6
"café" Length=4  UTF-8 bytes=5  UTF-16 bytes=8
"😀"   Length=2  UTF-8 bytes=4  UTF-16 bytes=4</code></pre>
    <p>.NET holds strings as UTF-16; almost everything else — HTTP, JSON, most databases — uses
    UTF-8. So a column declared as <code>VARCHAR(30)</code> may mean 30 <em>bytes</em>, which is
    30 ASCII letters, 15 accented ones, or seven emoji.</p>
    <p>When a limit matters, decide which of the four counts you mean — code units, code points,
    graphemes, or encoded bytes — and validate that one explicitly. "30 characters" on its own is
    not a specification.</p>
  </div>
</section>

<section id="building">
  <h2>Building strings, and what it costs</h2>

  <p>This is the first incident. Because a string cannot be changed, appending in a loop copies
  everything built so far, every time.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="03-building-strings.cs"><code>string report = string.Empty;
for (int i = 0; i &lt; lines; i++)
{
    report += "INV-" + i + ";";      // a brand-new string every time
}</code></pre>

<pre data-lang="console" data-title="dotnet run -c Release 03-building-strings.cs"><code>   lines     += in a loop    StringBuilder
--------------------------------------------
   5,000      32 ms  205.3 MB       0 ms    0.2 MB
  10,000     127 ms  838.7 MB       5 ms    0.4 MB
  20,000     607 ms 3488.5 MB       0 ms    0.7 MB
  40,000   3,486 ms 14510.2 MB       0 ms    1.5 MB</code></pre>

  <p>Read the third column downwards: <strong>205 MB, 839 MB, 3.5 GB, 14.5 GB</strong>. Each
  doubling of the line count roughly quadruples both time and garbage — the quadratic signature
  from <a href="#/m/t1-04-control-flow">Control Flow</a>. Building a 40,000-line report
  allocated fourteen and a half gigabytes to produce about one megabyte of text.</p>

  <p class="define"><span class="define__term">StringBuilder</span> A mutable buffer for building
  a string incrementally. It appends into space it already owns and produces the finished string
  once, at the end.</p>

  <p>The <code>StringBuilder</code> column is 1.5 MB and effectively zero milliseconds at every
  size.</p>

  <h3>But not every concatenation needs one</h3>

  <p>The advice "always use <code>StringBuilder</code>" is wrong, and measurably so. For a fixed,
  small number of pieces, <code>StringBuilder</code> is the <em>worst</em> choice:</p>

<pre data-lang="console" data-title="1,000,000 calls, bytes allocated per call"><code>a + b                    (2 pieces)      40.0
a + b + c                (3 pieces)      40.0
a + b + c + d            (4 pieces)      48.0
a + "-" + b + "-" + c    (5 pieces)     112.0
string.Concat(a,"-",b,"-",c)             48.0
$"{a}-{b}-{c}"                           48.0
StringBuilder for the same              152.0</code></pre>

  <p>Three things worth extracting from that table.</p>

  <p><strong>Up to four pieces, <code>+</code> costs one allocation</strong> — only the result
  string. The compiler turns it into a direct <code>String.Concat</code> call with a matching
  overload.</p>

  <p><strong>At five pieces it jumps to 112 bytes.</strong> There is no five-string overload, so
  the compiler falls back to <code>String.Concat(string[])</code> and allocates an array as well
  as the result. That step is invisible in the source: adding one more <code>+</code> to a line
  more than doubles its cost.</p>

  <p><strong>Writing <code>string.Concat(...)</code> explicitly avoids that</strong>, staying at
  48 bytes. Since .NET 9 there is a <code>params ReadOnlySpan&lt;string&gt;</code> overload, which
  the compiler satisfies from the stack rather than the heap — the same mechanism measured in
  <a href="#/m/t1-05-methods-and-parameters">Methods, Arguments, and Parameters</a>. The
  <code>+</code> operator's lowering still targets the older array overload.</p>

  <p>Interpolation is flat at 48 bytes regardless of how many holes it has, because since .NET 6
  it compiles to an interpolated string handler that writes into a pooled buffer. <strong>For
  ordinary formatting, interpolation is both the clearest and the cheapest option.</strong></p>

  <div class="callout callout--gotcha">
    <h4>Gotcha: pre-sizing a <code>StringBuilder</code> barely helps, and can hurt</h4>
    <p><a href="#/m/t1-06-arrays">Arrays</a> showed that telling <code>List&lt;T&gt;</code> its
    expected size removes real copying. The same advice is routinely given for
    <code>StringBuilder</code>. Measured, building a 208,890-character report:</p>
<pre data-lang="console" data-title="Output"><code>  capacity given    allocated
------------------------------
            none       833 KB
         104,445       832 KB
         208,890       816 KB
         417,780      1224 KB
         480,000      1346 KB</code></pre>
    <p>An exact capacity saves about 2%. Over-estimating by 2x costs <strong>47% more</strong>
    than not sizing at all.</p>
    <p>The reason is that <code>StringBuilder</code> does not hold one buffer it doubles and
    copies; it holds a <strong>linked list of chunks</strong>, so growing never copies what it
    already has. There is nothing for pre-sizing to save. Size it only when you know the answer
    closely, and never guess high.</p>
  </div>
</section>

<section id="comparison">
  <h2>Comparing strings</h2>

  <p>This is the second incident, and it is the one that is a security bug rather than a
  performance problem.</p>

  <p class="define"><span class="define__term">Ordinal comparison</span> Comparing the numeric
  values of code units, one at a time. Fast, exact, and identical on every machine on Earth.</p>

  <p class="define"><span class="define__term">Culture-sensitive comparison</span> Comparing
  according to the rules of a human language — which letters count as equal, how accents order,
  what uppercase means. Correct for text people read; wrong for text machines exchange.</p>

  <p>C#'s <code>==</code> on strings is <strong>ordinal</strong>, which is the right default:</p>

<pre data-lang="console" data-title="Output"><code>"Ledger" == "ledger"      -&gt; False
Equals(OrdinalIgnoreCase) -&gt; True</code></pre>

  <p>The danger is not <code>==</code>. It is <code>ToUpper</code>, <code>ToLower</code>, and any
  comparison that quietly uses the machine's culture.</p>

  <h3>The Turkish I</h3>

  <p>Turkish has two distinct letters: a dotted <em>i</em> and a dotless <em>ı</em>. Uppercasing
  <code>i</code> in Turkish gives <code>İ</code> — a capital I <em>with a dot</em> — not
  <code>I</code>.</p>

<pre data-lang="console" data-title="dotnet run 04-comparison-and-culture.cs"><code>"file".ToUpper(en-GB ) -&gt; "FILE"   equals "FILE"? True
"file".ToUpper(en-US ) -&gt; "FILE"   equals "FILE"? True
"file".ToUpper(tr-TR ) -&gt; "FİLE"   equals "FILE"? False
"file".ToUpper(az-AZ ) -&gt; "FİLE"   equals "FILE"? False
"file".ToUpperInvariant() -&gt; "FILE"   equals "FILE"? True

"FILE".ToLower(en-GB ) -&gt; "file"
"FILE".ToLower(tr-TR ) -&gt; "fıle"</code></pre>

  <p>Now put that in a security check:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="04-comparison-and-culture.cs"><code>string[] blocked = { "admin", "root" };
string requested = "ADMIN";

// WRONG: culture-sensitive lowering of a security-relevant identifier.
bool blockedNaive = Array.IndexOf(blocked, requested.ToLower()) &gt;= 0;

// RIGHT: ordinal, culture-independent.
bool blockedCorrect = blocked.Contains(requested, StringComparer.OrdinalIgnoreCase);</code></pre>

<pre data-lang="console" data-title="Output"><code>culture en-GB : ToLower() blocks "ADMIN"? True    ordinal blocks it? True
culture tr-TR : ToLower() blocks "ADMIN"? False   ordinal blocks it? True</code></pre>

  <p>On a Turkish-locale machine, <code>"ADMIN".ToLower()</code> produces <code>"admın"</code>
  with a dotless ı, which is not in the blocklist. <strong>The reserved username is
  accepted.</strong> Identical code, identical input, different answer — determined by the
  operating system's regional settings.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>This is not a Turkish problem; it is a "your code assumed a culture" problem. It also
    affects Azerbaijani, and there are comparable rules in other languages. Every
    <code>ToLower()</code> and <code>ToUpper()</code> without an explicit culture is a latent
    version of this bug.</p>
    <p>The rule is short: <strong>for anything a machine will compare — identifiers, keys,
    paths, headers, protocol tokens, file extensions — use
    <code>StringComparison.Ordinal</code> or <code>OrdinalIgnoreCase</code>.</strong> Reserve
    culture-sensitive comparison for text a person reads and sorts.</p>
    <p>Better still: do not case-fold in order to compare. <code>string.Equals(a, b,
    StringComparison.OrdinalIgnoreCase)</code> is faster than lowering both sides, allocates
    nothing, and cannot pick the wrong culture.</p>
  </div>

  <h3>Sorting differs too</h3>

<pre data-lang="console" data-title="Output"><code>input: Zebra Ärger Apfel
en-GB    Apfel Ärger Zebra
de-DE    Apfel Ärger Zebra
sv-SE    Apfel Zebra Ärger
ordinal  Apfel Zebra Ärger

input: apple Apple APPLE
en-GB    apple Apple APPLE
de-DE    apple Apple APPLE
ordinal  APPLE Apple apple</code></pre>

  <p>Swedish sorts <em>Ä</em> after <em>Z</em>; German and English sort it with <em>A</em>. And
  ordinal puts uppercase before lowercase, because <code>A</code> is code unit 65 and
  <code>a</code> is 97 — which is why an ordinal-sorted list looks wrong to a human.</p>

  <p>Both are correct for their purpose. A sorted list shown to a user should use their culture.
  A sorted list used to compute a signature, a merge, or a diff must use ordinal, or two machines
  will disagree.</p>

  <h3>Strings that look identical and are not equal</h3>

  <p class="define"><span class="define__term">Unicode normalisation</span> Rewriting text into a
  canonical form, so that characters with more than one valid representation compare equal.</p>

<pre data-lang="console" data-title="Output"><code>composed   : "é"  Length=1
decomposed : "é"  Length=2
ordinal equal?                       -&gt; False
after Normalize()                    -&gt; True
culture-sensitive (InvariantCulture) -&gt; True</code></pre>

  <p><code>é</code> can be one code point, or an <code>e</code> followed by a combining accent.
  They render identically and are ordinally different. A user who typed one and searched for the
  other finds nothing.</p>

  <p>The fix is to normalise at the boundary — call <code>Normalize()</code> when text enters
  your system — and then compare ordinally inside it. Normalising on every comparison is both
  slower and easy to forget somewhere.</p>
</section>

<section id="interning">
  <h2>Interning</h2>

  <p class="define"><span class="define__term">String interning</span> Keeping one shared copy of
  each distinct string value, so that identical strings are the same object.</p>

  <p class="define"><span class="define__term">Intern pool</span> The runtime table holding those
  shared copies. Every string <em>literal</em> in your source is placed in it automatically.</p>

<pre data-lang="console" data-title="dotnet run 05-interning-and-hashing.cs"><code>a == b                   : True
ReferenceEquals(a, b)    : True   &lt;-- one object, two names

built == a               : True
ReferenceEquals(built, a): False  &lt;-- equal value, different object

ReferenceEquals(folded,a): True   &lt;-- the compiler produced one literal</code></pre>

  <p>Two identical literals are the same object. A string assembled at run time is a different
  object with the same value. And two <code>const</code> strings concatenated are folded by the
  compiler into a single literal, so they are interned too.</p>

  <p>This is why <code>==</code> on strings is safe: it compares <em>value</em>, not reference.
  Never use <code>ReferenceEquals</code> to compare string values — it will be right for literals
  and wrong for everything else, which is the worst possible failure pattern.</p>

  <div class="callout callout--warn">
    <h4>Warning: <code>string.Intern</code> is almost always a mistake</h4>
    <p>It is tempting as a memory optimisation: if a million records share a few hundred distinct
    status values, interning them means one copy each.</p>
    <p>The problem is that <strong>the intern pool is never collected</strong>. Entries live for
    the life of the process. Interning values that come from users, files, or requests is an
    unbounded memory leak with no way to release it short of restarting.</p>
    <p>If you want deduplication with a bound, use your own
    <code>Dictionary&lt;string, string&gt;</code> or a cache you can clear, and keep control of
    its lifetime.</p>
  </div>
</section>

<section id="hashing">
  <h2>Hash codes are not stable</h2>

  <p>This is the fourth incident.</p>

  <p class="define"><span class="define__term">Hash randomisation</span> The runtime seeding
  string hashing with a random value chosen at process start, so the same string produces a
  different hash code in a different process.</p>

<pre data-lang="console" data-title="Two runs of the same program"><code>run 1:  "INV-2026".GetHashCode() : -472717176
run 2:  "INV-2026".GetHashCode() : -410450036</code></pre>

  <p>Same string, same code, same machine, same version — different number. This is deliberate.
  Without it, an attacker who can choose your dictionary keys can craft thousands of strings that
  all hash to the same bucket, turning every lookup into a linear scan and taking the service
  down with a small amount of traffic. Randomising the seed makes that impossible to precompute.
  It has been on by default since .NET Core 1.0.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>Never persist, transmit, or share a <code>GetHashCode()</code> result.</strong>
    Not as a cache key, not as a database column, not as a shard selector, not as an ETag. It is
    valid only inside the process that produced it, and only until that process restarts.</p>
    <p>The failure is nasty because it is invisible in development: one process, one seed,
    everything agrees. It appears when you scale to two instances, or after a deployment, and
    presents as a cache that never hits or a shard that cannot find its own data.</p>
    <p>When you need a hash that is stable across processes, use a real hash function over the
    encoded bytes:</p>
<pre data-lang="csharp" data-net="10"><code>byte[] bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
string stable = Convert.ToHexString(bytes);</code></pre>
    <p>That is deterministic everywhere, forever. It is slower than <code>GetHashCode</code>,
    which is the correct trade for something you are going to store.</p>
  </div>

  <p>Related, and worth saying explicitly: a <code>Dictionary</code> keyed by string should
  always be given a comparer, so its behaviour is stated rather than assumed:</p>

<pre data-lang="csharp" data-net="10" data-title="05-interning-and-hashing.cs"><code>Dictionary&lt;string, int&gt; caseSensitive = new Dictionary&lt;string, int&gt;(StringComparer.Ordinal);
Dictionary&lt;string, int&gt; caseInsensitive = new Dictionary&lt;string, int&gt;(StringComparer.OrdinalIgnoreCase);</code></pre>

<pre data-lang="console" data-title="Output"><code>ordinal dictionary contains "inv-1"          : False
OrdinalIgnoreCase dictionary contains "inv-1": True</code></pre>
</section>

<section id="production-example">
  <h2>The same ideas in a real service</h2>

  <p>Ledger normalises and validates payment references arriving from several partners, then uses
  them as dictionary keys. Every decision below is one from this module.</p>

<pre data-lang="csharp" data-net="10" data-title="Ledger — PaymentReference.cs"><code>using System.Globalization;
using System.Text;

/// &lt;summary&gt;
/// A validated payment reference. Normalised once, at the boundary, so that
/// every comparison inside the system can be a cheap ordinal one.
/// &lt;/summary&gt;
public readonly record struct PaymentReference
{
    private PaymentReference(string value) =&gt; Value = value;

    public string Value { get; }

    /// &lt;summary&gt;
    /// The single place raw text becomes a reference. Anything that reaches
    /// the rest of the system has already been through here.
    /// &lt;/summary&gt;
    public static bool TryParse(string? raw, out PaymentReference reference)
    {
        reference = default;

        // Whitespace-only input is empty as far as a human is concerned.
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        // Normalise Unicode at the boundary so "é" has one representation
        // from here on, whichever way the partner encoded it.
        string normalised = raw.Trim().Normalize(NormalizationForm.FormC);

        // ToUpperINVARIANT, never ToUpper(): a Turkish-locale host must not
        // produce a different reference from a British one.
        normalised = normalised.ToUpperInvariant();

        if (normalised.Length is &lt; 8 or &gt; 32)
        {
            return false;
        }

        foreach (char c in normalised)
        {
            // Ordinal character checks, not char.IsLetterOrDigit, which
            // accepts letters from every script on Earth.
            bool allowed = (c &gt;= 'A' &amp;&amp; c &lt;= 'Z')
                || (c &gt;= '0' &amp;&amp; c &lt;= '9')
                || c == '-';

            if (!allowed)
            {
                return false;
            }
        }

        reference = new PaymentReference(normalised);
        return true;
    }

    // Ordinal, because this is an identifier and not prose.
    public bool Equals(PaymentReference other) =&gt;
        string.Equals(Value, other.Value, StringComparison.Ordinal);

    public override int GetHashCode() =&gt;
        Value is null ? 0 : StringComparer.Ordinal.GetHashCode(Value);

    public override string ToString() =&gt; Value ?? string.Empty;
}

public sealed class ReferenceIndex
{
    // The comparer is stated, not inherited from a default nobody checked.
    private readonly Dictionary&lt;string, decimal&gt; _totals =
        new Dictionary&lt;string, decimal&gt;(StringComparer.Ordinal);

    public void Record(PaymentReference reference, decimal amount)
    {
        _totals.TryGetValue(reference.Value, out decimal current);
        _totals[reference.Value] = current + amount;
    }

    public decimal TotalFor(PaymentReference reference) =&gt;
        _totals.TryGetValue(reference.Value, out decimal total) ? total : 0m;

    /// &lt;summary&gt;
    /// Builds an audit line. Interpolation rather than StringBuilder: a fixed,
    /// small number of pieces, measured at 48 bytes against 152.
    /// &lt;/summary&gt;
    public string DescribeFor(PaymentReference reference) =&gt;
        $"{reference.Value}: {TotalFor(reference).ToString("0.00", CultureInfo.InvariantCulture)}";

    /// &lt;summary&gt;
    /// Builds the whole report. StringBuilder here, because the number of
    /// pieces grows with the data: += in this loop measured 14.5 GB at 40,000 rows.
    /// &lt;/summary&gt;
    public string BuildReport()
    {
        StringBuilder builder = new StringBuilder();
        foreach (KeyValuePair&lt;string, decimal&gt; entry in _totals)
        {
            builder.Append(entry.Key)
                   .Append(',')
                   .Append(entry.Value.ToString("0.00", CultureInfo.InvariantCulture))
                   .Append('\\n');
        }
        return builder.ToString();
    }
}</code></pre>

  <p>Six decisions, each explained by a section above:</p>

  <ul>
    <li><strong>Normalise once, at the boundary.</strong> Every comparison afterwards can be
    ordinal, which is fast and culture-proof.</li>
    <li><strong><code>ToUpperInvariant</code>, never <code>ToUpper</code>.</strong> A
    Turkish-locale host must not produce a different reference from a British one.</li>
    <li><strong>Explicit character ranges rather than <code>char.IsLetterOrDigit</code>,</strong>
    which accepts digits and letters from every script — including ones that look like ASCII.</li>
    <li><strong>The dictionary is given a comparer,</strong> so its case behaviour is stated in
    the code rather than left to whoever reads it.</li>
    <li><strong>Interpolation for the one-line description, <code>StringBuilder</code> for the
    report.</strong> The measurements say which is right at which size.</li>
    <li><strong><code>IsNullOrWhiteSpace</code>, not <code>IsNullOrEmpty</code></strong>, because
    a reference of three spaces is not a reference.</li>
  </ul>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Concatenating in a loop</h3>

  <p>Measured at 14.5 GB and 3.5 seconds for 40,000 lines. Quadratic in both time and garbage.
  Use <code>StringBuilder</code> whenever the number of pieces grows with the data.</p>

  <h3>2. <code>ToLower()</code> or <code>ToUpper()</code> without a culture</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>if (input.ToLower() == "admin") { Reject(); }</code></pre>

  <p>Fails on a Turkish-locale machine, as measured. Use
  <code>string.Equals(input, "admin", StringComparison.OrdinalIgnoreCase)</code>, which is also
  faster and allocates nothing.</p>

  <h3>3. Treating <code>Length</code> as a character count</h3>

  <p>A "man technologist" emoji has <code>Length</code> 5. Validation limits, truncation, and
  progress indicators built on <code>Length</code> all misbehave on real user input, and
  truncation can produce invalid text.</p>

  <h3>4. Persisting a hash code</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>string cacheKey = $"user:{email.GetHashCode()}";</code></pre>

  <p>Different in every process. Works perfectly on one instance and fails the moment there are
  two. Use SHA-256 over the UTF-8 bytes, or the string itself.</p>

  <h3>5. <code>string.Intern</code> on user data</h3>

  <p>The pool is never collected, so this is an unbounded leak that a restart is the only cure
  for.</p>

  <h3>6. <code>Substring</code> in a hot loop</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>for (int i = 0; i &lt; fields.Length; i++)
{
    string field = line.Substring(offsets[i], lengths[i]);   // allocates every time
}</code></pre>

  <p>Measured at 48 bytes for a 13-character slice; <code>line.AsSpan(offset, length)</code>
  allocated <strong>zero</strong>. For parsing, slice with spans and only materialise a string
  when you actually need to keep one.</p>

  <h3>7. Comparing with <code>ReferenceEquals</code></h3>

  <p>True for literals, false for identical runtime-built strings. It will pass every test you
  write with literals and fail on real data.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>Symptom: enormous allocation rate from a job that produces a small file</h4>
    <ol>
      <li><strong>Measure allocation, not memory in use.</strong> A quadratic concatenation is
      all collected, so peak memory can look fine while the allocation rate is enormous:
<pre data-lang="csharp" data-net="10"><code>long before = GC.GetAllocatedBytesForCurrentThread();
BuildTheReport();
Console.WriteLine($"{(GC.GetAllocatedBytesForCurrentThread() - before) / 1024 / 1024} MB");</code></pre>
      </li>
      <li><strong>Check the scaling.</strong> Run at n and 2n rows. Roughly four times the
      allocation for twice the rows is a quadratic concatenation, not a large dataset.</li>
      <li><strong>Take a heap snapshot</strong> with <code>dotnet-gcdump collect --process-id
      1234</code> and look for a large count of <code>System.String</code> instances of steadily
      increasing length. That pattern is a growing accumulator.</li>
      <li><strong>Fix with <code>StringBuilder</code></strong> when the piece count grows with
      the data, and leave <code>+</code> or interpolation alone where it does not.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: correct on your machine, wrong on one server or for one user</h4>
    <ol>
      <li><strong>Print the culture and compare:</strong>
<pre data-lang="csharp" data-net="10"><code>Console.WriteLine(CultureInfo.CurrentCulture.Name);
Console.WriteLine("i".ToUpper());          // "I" or "İ"?</code></pre>
      </li>
      <li><strong>Reproduce locally by forcing the culture</strong> rather than trying to obtain
      the machine:
<pre data-lang="csharp" data-net="10"><code>CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("tr-TR");</code></pre>
      Add this to a test. A culture test costs nothing and catches an entire bug class.</li>
      <li><strong>Grep for the real culprits:</strong> <code>.ToLower()</code>,
      <code>.ToUpper()</code>, <code>.Equals(</code> with no <code>StringComparison</code>,
      <code>string.Compare</code> with no comparison, and <code>StartsWith</code>/
      <code>EndsWith</code> with a single argument — all default to culture-sensitive.</li>
      <li><strong>Prevent the class entirely</strong> by enabling the analyzer that flags them:
      CA1305, CA1307, and CA1309 exist for exactly this, and turning them into build errors is a
      one-line change.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: a cache or lookup that never hits across instances</h4>
    <ol>
      <li><strong>Look for <code>GetHashCode</code> in the key path.</strong> Print the key from
      two processes with the same input. Different values confirm it immediately.</li>
      <li><strong>Check for culture in the key too</strong> — a key built with
      <code>DateTime.ToString()</code> or a number formatted without
      <code>InvariantCulture</code> varies by machine in the same way.</li>
      <li><strong>Check for normalisation differences.</strong> If one service normalises text
      and another does not, visually identical keys will not match.</li>
      <li><strong>Fix by making the key explicit and deterministic:</strong> the string itself,
      or SHA-256 over its UTF-8 bytes. Never a runtime hash code.</li>
    </ol>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's nightly settlement export writes one line per transaction. It was written with
    <code>report += line;</code> inside the loop, ran in about 40 milliseconds against the 500
    transactions the platform had at launch, and was never revisited.</p>
    <p>The measured cost as volume grew, from the benchmark in this module:</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Lines</th><th><code>+=</code> time</th><th><code>+=</code> allocated</th><th><code>StringBuilder</code></th></tr></thead>
        <tbody>
          <tr><td>5,000</td><td>32 ms</td><td>205 MB</td><td>0 ms / 0.2 MB</td></tr>
          <tr><td>10,000</td><td>127 ms</td><td>839 MB</td><td>5 ms / 0.4 MB</td></tr>
          <tr><td>20,000</td><td>607 ms</td><td>3.5 GB</td><td>0 ms / 0.7 MB</td></tr>
          <tr><td>40,000</td><td>3,486 ms</td><td><strong>14.5 GB</strong></td><td>0 ms / 1.5 MB</td></tr>
        </tbody>
      </table>
    </div>
    <p>At 40,000 transactions the export allocated <strong>fourteen and a half gigabytes</strong>
    to produce roughly one megabyte of CSV. The container had a 2 GB memory limit and did not
    exceed it — every intermediate string was collected almost immediately — so no
    out-of-memory alert ever fired. What did happen was that the garbage collector ran
    continuously for three and a half seconds, and because the export shared a process with the
    payments API, <strong>every request served during that window paid the collection
    pauses</strong>. The p99 latency alert fired nightly at 02:00 and was assumed to be the
    database.</p>
    <p>The fix was four lines of <code>StringBuilder</code>, taking the export to 1.5 MB and
    effectively zero time.</p>
    <p>Two things make this worth a section rather than a footnote. First, <strong>the metric
    that would have found it is allocation rate, not memory usage</strong> — the service's
    memory graph was flat and healthy throughout. Second, the damage landed on a
    <em>different</em> component from the one containing the bug, which is why it was
    misdiagnosed for months.</p>
    <p>The cheap check that would have caught it at review: <em>does the number of pieces being
    concatenated grow with the data?</em> If yes, it needs a <code>StringBuilder</code>. If it is
    a fixed handful, leave the interpolation alone — measured at 48 bytes against
    <code>StringBuilder</code>'s 152.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Always use <code>StringBuilder</code> instead of <code>+</code>."</strong></p>
    <p>Measured false for a fixed, small number of pieces: <code>StringBuilder</code> cost 152
    bytes per call against 48 for interpolation, because it allocates a builder and a buffer
    before producing the same string. The rule is about <em>growth</em>: use
    <code>StringBuilder</code> when the number of pieces grows with the data, and interpolation
    when it does not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Pre-sizing a <code>StringBuilder</code> avoids reallocation, like
    <code>List&lt;T&gt;</code>."</strong></p>
    <p>An exact capacity saved 2%; over-estimating by 2x cost 47% <em>more</em> than not sizing
    at all. <code>StringBuilder</code> holds a linked list of chunks rather than one buffer it
    doubles, so growing never copies existing content. There is nothing for pre-sizing to
    save.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>string.Length</code> is the number of characters."</strong></p>
    <p>It is the number of UTF-16 code units. Measured: a flag emoji is 4, a
    "man technologist" emoji is 5, and an accented letter written in decomposed form is 2 —
    each of which a person sees as one character. Use <code>StringInfo</code> for graphemes when
    a limit is meant to be about what the user typed.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>ToLower()</code> then compare is a fine way to ignore case."</strong></p>
    <p>It allocates two strings, it is slower than an ordinal ignore-case comparison, and it
    silently produces the wrong answer on Turkish and Azerbaijani locales — demonstrated above
    letting <code>ADMIN</code> past a blocklist containing <code>admin</code>. Use
    <code>StringComparison.OrdinalIgnoreCase</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>InvariantCulture</code> means no culture."</strong></p>
    <p>It is a culture — roughly English — with its own casing and sorting rules. It is the right
    choice for machine-readable formatting of numbers and dates, and the <em>wrong</em> choice
    for comparing identifiers, where <code>Ordinal</code> is both faster and exact. "Invariant"
    means "does not vary by machine", not "has no rules".</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Using <code>GetHashCode()</code> for anything that outlives the process.</strong></p>
    <p>String hashing is randomly seeded per process, deliberately, to prevent hash-collision
    denial-of-service attacks. A hash code is a bucket hint, not an identifier. Anything stored,
    transmitted, or compared across processes needs a real hash function.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Situation</th><th>Use</th><th>Because</th></tr></thead>
      <tbody>
        <tr><td>Joining a fixed handful of values</td><td>Interpolation</td><td>Clearest, and measured cheapest at 48 bytes.</td></tr>
        <tr><td>Five or more pieces in one expression</td><td><code>string.Concat(...)</code></td><td>Avoids the array the <code>+</code> chain allocates: 48 bytes against 112.</td></tr>
        <tr><td>Joining a collection with a separator</td><td><code>string.Join</code></td><td>One pass, one allocation, no loop to get wrong.</td></tr>
        <tr><td>Building text whose size grows with the data</td><td><code>StringBuilder</code></td><td>Avoids quadratic copying. Measured 1.5 MB against 14.5 GB.</td></tr>
        <tr><td>Comparing identifiers, keys, paths, tokens</td><td><code>StringComparison.Ordinal</code></td><td>Exact, fast, identical on every machine.</td></tr>
        <tr><td>Case-insensitive identifier comparison</td><td><code>OrdinalIgnoreCase</code></td><td>No allocation, and immune to the Turkish-I bug.</td></tr>
        <tr><td>Sorting text a person will read</td><td><code>StringComparer.CurrentCulture</code></td><td>Ordinal order looks wrong to humans.</td></tr>
        <tr><td>Formatting numbers or dates for a file or API</td><td><code>CultureInfo.InvariantCulture</code></td><td>Stable across machines. See <a href="#/m/t1-02-variables-and-types">Variables and Types</a>.</td></tr>
        <tr><td>A dictionary keyed by string</td><td>Pass a <code>StringComparer</code></td><td>States the case behaviour instead of leaving it to be discovered.</td></tr>
        <tr><td>Parsing fields out of a line</td><td><code>AsSpan</code> and slicing</td><td>Zero allocation against 48 bytes per <code>Substring</code>.</td></tr>
        <tr><td>A key that must be stable across processes</td><td>SHA-256 over UTF-8 bytes</td><td><code>GetHashCode</code> is randomised per process.</td></tr>
        <tr><td>Validating a length limit on user input</td><td><code>StringInfo</code> graphemes</td><td><code>Length</code> counts code units, not characters.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Predict each result, and name the rule.</p>
<pre data-lang="csharp" data-net="10"><code>// (a)
string a = "INV-1";
string b = "INV-1";
Console.WriteLine(ReferenceEquals(a, b));

// (b)
string prefix = "INV-";
string built = prefix + "1";
Console.WriteLine(ReferenceEquals(built, a));
Console.WriteLine(built == a);

// (c)
string s = "hello";
string t = s.ToUpperInvariant();
Console.WriteLine(s);

// (d)
Console.WriteLine("\\U0001F600".Length);

// (e)
Console.WriteLine("Ledger" == "ledger");
Console.WriteLine(string.Equals("Ledger", "ledger", StringComparison.OrdinalIgnoreCase));</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <ul>
          <li><strong>(a) <code>True</code>.</strong> Identical literals are interned, so both
          names refer to one object.</li>
          <li><strong>(b) <code>False</code> then <code>True</code>.</strong> A string built at
          run time is a new object, so <code>ReferenceEquals</code> is false. <code>==</code>
          compares value, so it is true. This pair is the reason never to use
          <code>ReferenceEquals</code> on strings: it would have returned <code>True</code> in
          (a) and misled you.</li>
          <li><strong>(c) <code>hello</code>.</strong> Strings are immutable.
          <code>ToUpperInvariant</code> returned a new string that was assigned to
          <code>t</code>; <code>s</code> is untouched. Forgetting to use the return value is the
          single most common string mistake.</li>
          <li><strong>(d) <code>2</code>.</strong> The emoji is outside the range one 16-bit code
          unit can hold, so it is stored as a surrogate pair. <code>Length</code> counts code
          units.</li>
          <li><strong>(e) <code>False</code> then <code>True</code>.</strong> <code>==</code> on
          strings is ordinal and case-sensitive. <code>OrdinalIgnoreCase</code> is the
          culture-independent way to ignore case.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This method validates and canonicalises usernames for a service deployed in several
    countries. It contains five problems from this module. Find them, say what each causes, and
    rewrite it.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public static class Usernames
{
    private static readonly string[] Reserved = { "admin", "root", "system" };

    public static bool TryCanonicalise(string input, out string canonical)
    {
        canonical = "";

        if (input == null || input == "")
        {
            return false;
        }

        canonical = input.Trim().ToLower();

        if (canonical.Length &lt; 3 || canonical.Length &gt; 20)
        {
            return false;
        }

        foreach (string reserved in Reserved)
        {
            if (canonical.Equals(reserved))
            {
                return false;
            }
        }

        return true;
    }

    public static string CacheKeyFor(string username) =&gt;
        "user:" + username.GetHashCode();
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>1. <code>ToLower()</code> uses the machine's culture.</strong> On a
        Turkish-locale host, <code>"ADMIN".ToLower()</code> is <code>"admın"</code> with a dotless
        ı, which does not match <code>"admin"</code> — so the reserved name is accepted.
        Demonstrated in this module. Use <code>ToLowerInvariant()</code>, or better, do not
        case-fold to compare at all.</p>

        <p><strong>2. <code>canonical.Equals(reserved)</code> with no
        <code>StringComparison</code>.</strong> The one-argument <code>string.Equals</code>
        instance method is ordinal, so this one happens to be safe — but it reads as though the
        author did not decide, and the sibling APIs (<code>StartsWith</code>,
        <code>EndsWith</code>, <code>Compare</code>, <code>IndexOf</code>) default to
        <strong>culture-sensitive</strong>. Always state the comparison; the habit is what
        protects you.</p>

        <p><strong>3. <code>Length</code> is used as a character limit.</strong> A three-emoji
        username has <code>Length</code> 6 or more and a "man technologist" emoji alone is 5, so
        the 3–20 range is really a code-unit range. Users with non-Latin names are rejected
        arbitrarily.</p>

        <p><strong>4. No Unicode normalisation.</strong> Two users can register visually
        identical names — one with a composed <code>é</code>, one decomposed — and both pass,
        because ordinally they differ. That is an account-impersonation risk.</p>

        <p><strong>5. <code>GetHashCode()</code> in a cache key.</strong> Randomised per process,
        so two instances compute different keys for the same user and the cache never hits.
        Invisible with one instance.</p>

        <p>Minor: <code>input == ""</code> misses whitespace-only input, and <code>canonical =
        ""</code> should be <code>string.Empty</code> for clarity.</p>

        <p>The rewrite:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>using System.Globalization;
using System.Security.Cryptography;
using System.Text;

public static class Usernames
{
    private static readonly HashSet&lt;string&gt; Reserved =
        new HashSet&lt;string&gt;(StringComparer.OrdinalIgnoreCase) { "admin", "root", "system" };

    public static bool TryCanonicalise(string? input, out string canonical)
    {
        canonical = string.Empty;

        // Whitespace-only input is empty as far as a person is concerned.
        if (string.IsNullOrWhiteSpace(input))
        {
            return false;
        }

        // Normalise first, so visually identical names cannot both be taken.
        string trimmed = input.Trim().Normalize(NormalizationForm.FormC);

        // Invariant, never culture-sensitive: this is an identifier.
        string lowered = trimmed.ToLowerInvariant();

        // Count what the user sees, not UTF-16 code units.
        int graphemes = 0;
        TextElementEnumerator enumerator = StringInfo.GetTextElementEnumerator(lowered);
        while (enumerator.MoveNext())
        {
            graphemes++;
        }

        if (graphemes &lt; 3 || graphemes &gt; 20)
        {
            return false;
        }

        // Ordinal ignore-case, and a set rather than a loop.
        if (Reserved.Contains(lowered))
        {
            return false;
        }

        canonical = lowered;
        return true;
    }

    /// &lt;summary&gt;
    /// Stable across processes and deployments, unlike GetHashCode().
    /// &lt;/summary&gt;
    public static string CacheKeyFor(string username)
    {
        ArgumentNullException.ThrowIfNull(username);

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(username));
        return "user:" + Convert.ToHexString(hash);
    }
}</code></pre>
        <p><strong>One judgement worth stating.</strong> Normalisation and case-folding do not
        make two names "the same person" in every sense — Unicode has many pairs of characters
        that look alike but are genuinely different (Latin <code>a</code> and Cyrillic
        <code>а</code>, for instance). Defending against deliberate look-alike registration needs
        a confusables check, which is a bigger topic. What this rewrite fixes is the
        <em>accidental</em> collisions and the culture bug.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A nightly job's memory graph is flat and healthy, but the API sharing its process has a p99
    latency spike every night at exactly the time the job runs. Describe how you would establish
    that string building is the cause, and what you would change.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why the memory graph is the wrong place to look.</strong> A quadratic
        concatenation produces enormous <em>garbage</em>, not enormous <em>live</em> memory. Every
        intermediate string becomes unreachable immediately, so gen-0 collections reclaim them
        almost at once. Working-set stays flat. The cost is entirely in the collector running
        constantly, and collection pauses every thread in the process — including the API's.</p>

        <p><strong>Establishing it, in order of effort:</strong></p>
        <ol>
          <li><strong>Watch allocation rate, not memory:</strong>
<pre data-lang="bash" data-title="terminal"><code>dotnet-counters monitor --process-id 1234 --counters System.Runtime</code></pre>
          <code>alloc-rate</code> in the hundreds of MB per second with a flat
          <code>gc-heap-size</code>, and a <code>gen-0-gc-count</code> climbing fast, is the
          signature. It says "producing garbage quickly", which is exactly a concatenation
          loop.</li>
          <li><strong>Correlate the windows.</strong> If the allocation spike and the latency
          spike start and stop together, and the job is the only thing running, the case is
          effectively made without touching the code.</li>
          <li><strong>Measure the job directly:</strong>
<pre data-lang="csharp" data-net="10"><code>long before = GC.GetAllocatedBytesForCurrentThread();
BuildTheReport();
long mb = (GC.GetAllocatedBytesForCurrentThread() - before) / 1024 / 1024;</code></pre>
          A number wildly disproportionate to the output size — 14,510 MB for a 1 MB file, as
          measured in this module — is conclusive.</li>
          <li><strong>Confirm the shape.</strong> Run at n and 2n rows. Roughly four times the
          allocation for twice the rows means quadratic, which points at concatenation rather
          than merely a large amount of data.</li>
        </ol>

        <p><strong>The change:</strong></p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>StringBuilder builder = new StringBuilder();
foreach (Transaction transaction in transactions)
{
    builder.Append(transaction.Reference)
           .Append(',')
           .Append(transaction.Amount.ToString("0.00", CultureInfo.InvariantCulture))
           .Append('\\n');
}
string report = builder.ToString();</code></pre>

        <p><strong>Better still, do not build the whole string at all.</strong> The report is
        written to a file or a response, so it never needs to exist in memory as one object:</p>
<pre data-lang="csharp" data-net="10" data-title="Better"><code>await using StreamWriter writer = new StreamWriter(path);
foreach (Transaction transaction in transactions)
{
    await writer.WriteLineAsync(
        $"{transaction.Reference},{transaction.Amount.ToString("0.00", CultureInfo.InvariantCulture)}");
}</code></pre>
        <p>This allocates one small string per line, all of which die in generation 0, and it
        never holds the report in memory. It also avoids the Large Object Heap entirely — a
        one-megabyte report string is more than twenty times the 85,000-byte threshold measured
        in <a href="#/m/t1-06-arrays">Arrays</a>.</p>

        <p><strong>The organisational fix</strong> matters as much: the job shared a process with
        the API, so its garbage became the API's latency. Even after this repair, a batch job
        that allocates heavily belongs in its own process, where its collection pauses cannot
        reach request handling.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write <code>SplitFields</code>, which parses a comma-separated line into a caller-supplied
    buffer <strong>without allocating a string per field</strong>, and returns how many fields it
    found. Then explain why the obvious <code>Split</code> version allocates so much, and what
    the span version cannot do.</p>
<pre data-lang="csharp" data-net="10"><code>// "INV-1,144.00,GBP" with a 3-element buffer -&gt; 3, and the ranges of each field
public static int SplitFields(ReadOnlySpan&lt;char&gt; line, Span&lt;Range&gt; fields)
{
    throw new NotImplementedException();
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why <code>string.Split</code> is expensive.</strong>
        <code>line.Split(',')</code> allocates a <code>string[]</code> <em>and</em> a new string
        for every field, because a string cannot reference part of another string — it owns its
        characters. Parsing a 3-field line allocates four objects. Over a million-line file that
        is four million objects, most of which are discarded after a single comparison.</p>

        <p><strong>The insight:</strong> a field is fully described by a start and a length into
        the line you already have. <code>Range</code> carries exactly that, and
        <code>ReadOnlySpan&lt;char&gt;</code> lets the caller look at the characters without
        copying them.</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public static int SplitFields(ReadOnlySpan&lt;char&gt; line, Span&lt;Range&gt; fields)
{
    if (fields.Length == 0)
    {
        return 0;
    }

    int count = 0;
    int start = 0;

    for (int i = 0; i &lt; line.Length; i++)
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

    // The final field: everything after the last comma, including an empty
    // trailing field for a line that ends in a separator.
    if (count == fields.Length)
    {
        return -1;
    }

    fields[count++] = new Range(start, line.Length);
    return count;
}</code></pre>

        <p>Using it, with no string allocated unless a field is actually kept:</p>
<pre data-lang="csharp" data-net="10" data-title="Calling it"><code>ReadOnlySpan&lt;char&gt; line = "INV-1,144.00,GBP";
Span&lt;Range&gt; fields = stackalloc Range[8];

int count = SplitFields(line, fields);

for (int i = 0; i &lt; count; i++)
{
    ReadOnlySpan&lt;char&gt; field = line[fields[i]];

    // Compare without allocating.
    if (field.SequenceEqual("GBP"))
    {
        Console.WriteLine($"field {i} is the currency");
    }
}

// Parse straight from the span - no intermediate string.
decimal amount = decimal.Parse(line[fields[1]], CultureInfo.InvariantCulture);</code></pre>

        <p><strong>Four details this has to get right,</strong> and they are where it goes
        wrong:</p>
        <ol>
          <li><strong>The last field has no trailing separator</strong>, so it must be added after
          the loop. Forgetting this silently drops the final column — the most common bug
          here.</li>
          <li><strong>A trailing comma means a real empty field.</strong>
          <code>"a,b,"</code> has three fields, the last empty. The code above produces that;
          special-casing it away is usually wrong for CSV.</li>
          <li><strong>The buffer can overflow.</strong> Returning <code>-1</code> is one choice;
          throwing is another. Silently truncating is not, because the caller cannot tell.</li>
          <li><strong>The spans borrow the line's memory.</strong> They are valid only while
          <code>line</code> is, which is what <code>ref struct</code> rules enforce — see
          <a href="#/m/t2-19-span-and-memory">Span and Memory</a>.</li>
          <li><strong>The <code>stackalloc</code> must live outside any loop.</strong> Stack
          memory is released when the <em>method</em> returns, not when the iteration ends:
<pre data-lang="csharp" data-net="10" data-bad="true"><code>for (int i = 0; i &lt; 200_000; i++)
{
    Span&lt;Range&gt; buffer = stackalloc Range[8];   // never released until the method ends
    SplitFields(lines[i], buffer);
}</code></pre>
          The compiler warns — <code>CA2014: Potential stack overflow. Move the stackalloc out
          of the loop</code> — and writing this module produced a real
          <code>Stack overflow.</code> crash before that warning was heeded. Hoist the buffer
          above the loop and reuse it.</li>
        </ol>

        <p><strong>What it is worth.</strong> Parsing 200,000 three-field lines:</p>
<pre data-lang="console" data-title="Output"><code>string.Split(',') -&gt;   29.0 MB  (152 bytes/line)
SplitFields       -&gt;    0.0 MB  (0 bytes/line)</code></pre>

        <p><strong>What the span version cannot do.</strong> Three real limitations, and pretending
        otherwise is how people get hurt by this technique:</p>
        <ul>
          <li><strong>You cannot store the result.</strong> A <code>ReadOnlySpan&lt;char&gt;</code>
          cannot be put in a field, a list, or an <code>async</code> method's state. The moment
          you need to <em>keep</em> a field, you call <code>ToString()</code> and take the
          allocation — which is fine, because you are keeping it deliberately rather than by
          accident.</li>
          <li><strong>It does not handle quoted CSV.</strong> A field containing a comma inside
          quotes breaks it. Real CSV is not a split problem, and a proper parser is the right
          answer there.</li>
          <li><strong>It is more code.</strong> <code>line.Split(',')</code> is one line and
          correct. Reach for this only where a profiler shows the allocation matters — in a
          parser processing millions of lines, not in a method that runs once per request.</li>
        </ul>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What happens when you call <code>s.Trim()</code> and ignore the result?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Nothing observable. Strings are immutable, so <code>Trim</code> returns a new string
        and leaves <code>s</code> untouched. Every string method works this way; the result is
        the only output.</p>
      </div></details>
    </li>
    <li>
      <p>Why is concatenating in a loop quadratic?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A string cannot be extended, so each <code>+=</code> allocates a new string and copies
        everything accumulated so far. Measured at 14.5 GB and 3.5 seconds for 40,000 lines,
        against 1.5 MB and effectively zero for <code>StringBuilder</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Is <code>StringBuilder</code> always better than <code>+</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. For a fixed, small number of pieces it is the worst option — 152 bytes per call
        against 48 for interpolation — because it allocates a builder and a buffer first. Use it
        when the number of pieces grows with the data.</p>
      </div></details>
    </li>
    <li>
      <p>Does <code>string.Length</code> tell you how many characters a user typed?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No — it counts UTF-16 code units. A grinning face is 2, a flag is 4, and a
        "man technologist" emoji is 5, all of which look like one character. Use
        <code>StringInfo</code> to count graphemes when the limit is about what the user sees.</p>
      </div></details>
    </li>
    <li>
      <p>Why can <code>"ADMIN".ToLower()</code> fail to match <code>"admin"</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>ToLower()</code> uses the machine's culture. In Turkish and Azerbaijani, the
        lowercase of <code>I</code> is the dotless <code>ı</code>, so the result is
        <code>"admın"</code>. Use <code>StringComparison.OrdinalIgnoreCase</code>, which allocates
        nothing and cannot vary by machine.</p>
      </div></details>
    </li>
    <li>
      <p>Why must you never store a string's <code>GetHashCode()</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>String hashing is seeded randomly at process start, so the same string hashes
        differently in a different process — measured as −472717176 and −410450036 across two
        runs. That randomisation exists to prevent hash-collision denial-of-service attacks. For
        a stable key, use SHA-256 over the UTF-8 bytes.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>string.Intern</code> on user input dangerous?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The intern pool is never garbage collected. Anything interned lives for the life of the
        process, so interning unbounded user data is a memory leak that only a restart clears.
        Use your own dictionary or cache if you want deduplication you can control.</p>
      </div></details>
    </li>
  </ol>

  <div class="callout callout--note">
    <h4>Where this leads</h4>
    <p><a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a> takes the
    hashing contract apart properly, including why a mutable key corrupts a dictionary.
    <a href="#/m/t2-21-string-without-allocation">String Handling Without Allocation</a> is where
    the <code>AsSpan</code> technique from Exercise 4 becomes a full toolkit, and
    <a href="#/m/t2-19-span-and-memory">Span and Memory</a> explains the rules that make it safe.
    <a href="#/m/t5-30-injection-attacks">SQL Injection, XSS, CSRF, SSRF, Mass Assignment</a>
    picks up where string handling becomes a security boundary rather than a correctness
    one.</p>
  </div>
</section>

`
});
