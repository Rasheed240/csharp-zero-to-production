/* ============================================================================
   Track 1, Module 2 — Variables and Types
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled and run on
   .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-02-variables-and-types/.
   ========================================================================= */

CSPREP.module({
  id: "t1-02-variables-and-types",
  minutes: 55,
  updated: "2026-08-29",
  summary:
    "A type is a promise about what a piece of data means, how much room it needs, and what " +
    "you may do with it. Choosing the wrong one is how invoices end up a penny out, counters " +
    "go negative, and a price of 1.234 becomes 1234 on a server in Frankfurt.",
  terms: [
    "variable", "declaration", "assignment", "initialisation", "type", "literal",
    "definite assignment", "default value", "integral type", "signed", "unsigned",
    "overflow", "checked", "unchecked", "floating-point", "IEEE 754", "precision",
    "decimal", "implicit conversion", "explicit conversion", "cast", "narrowing",
    "widening", "parsing", "culture", "invariant culture", "var", "type inference",
    "const", "readonly", "nullable value type"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Three bug reports arrive in the same week at a payments company.</p>

  <p>The first: an invoice for three line items shows a total one penny higher than the sum a
  customer calculated by hand. The individual lines are all correct. Adding them up in a
  calculator gives the customer's number, not the system's. Nobody has changed the invoicing
  code in months.</p>

  <p>The second: a dashboard showing cumulative payment volume displays a large
  <em>negative</em> number. The company has never issued a refund larger than a few hundred
  pounds. The figure was correct yesterday.</p>

  <p>The third: a European partner reports that a product they priced at 1.234 euros is being
  charged at 1,234 euros. The same request works perfectly from the London office.</p>

  <p>None of these is a logic error. Nobody wrote a wrong formula. In each case the code says
  exactly what its author meant, and the machine did something else, because <strong>the author
  chose a type that could not hold what they were asking it to hold</strong> — or a type whose
  behaviour they had assumed rather than checked.</p>

  <p>This module is about the decision that causes all three: what type to store a value in.
  It is the most frequently made decision in programming and the one most often made on
  autopilot.</p>
</section>

<section id="variables">
  <h2>What a variable actually is</h2>

  <p>Every term is defined before it is used again. That is a rule for this whole curriculum.</p>

  <p class="define"><span class="define__term">Memory</span> The working space your program uses
  while running. Physically it is RAM: a very long row of numbered slots, each holding a tiny
  amount of data. When the program stops, it is all handed back.</p>

  <p class="define"><span class="define__term">Variable</span> A name in your source code that
  refers to a place in memory holding a value. The name exists only for you; once compiled, the
  program works with the location. "Variable" because the value can change — the name stays put
  while what it holds moves.</p>

  <p class="define"><span class="define__term">Declaration</span> The statement that brings a
  variable into existence and says what type it is: <code>int invoiceCount;</code></p>

  <p class="define"><span class="define__term">Assignment</span> Putting a value into a
  variable, with <code>=</code>. Note that <code>=</code> means "put this value in here", not
  "these are equal". Testing equality is a different operator, <code>==</code>.</p>

  <p class="define"><span class="define__term">Initialisation</span> The first assignment to a
  variable, usually written in the same line as the declaration:
  <code>int invoiceCount = 3;</code></p>

  <p class="define"><span class="define__term">Literal</span> A value written directly in the
  source: <code>3</code>, <code>"Acme Ltd"</code>, <code>144.00m</code>, <code>true</code>.
  Literals have types of their own, which matters more than it sounds — a point this module
  returns to twice.</p>

  <p>Here is all of that in one runnable program.</p>

<pre data-lang="csharp" data-net="10" data-title="01-declaring.cs"><code>int invoiceCount = 3;
decimal amountDue = 144.00m;
string customerName = "Acme Ltd";
bool isPaid = false;

Console.WriteLine($"invoiceCount = {invoiceCount}");
Console.WriteLine($"amountDue    = {amountDue}");
Console.WriteLine($"customerName = {customerName}");
Console.WriteLine($"isPaid       = {isPaid}");

// Declaration first, assignment later, is also legal.
int retryCount;
retryCount = 0;
retryCount = retryCount + 1;
Console.WriteLine($"retryCount   = {retryCount}");</code></pre>

<pre data-lang="console" data-title="Output"><code>invoiceCount = 3
amountDue    = 144.00
customerName = Acme Ltd
isPaid       = False
retryCount   = 1</code></pre>

  <p>Read <code>retryCount = retryCount + 1;</code> as an instruction, not a claim: take what is
  in <code>retryCount</code>, add one, put the result back. As a statement of equality it would
  be nonsense, which is the usual first stumbling block with <code>=</code>.</p>

  <h3>You cannot read a variable you never wrote to</h3>

  <p class="define"><span class="define__term">Definite assignment</span> The compiler's rule
  that a local variable must be given a value before it is read. It traces every path through
  your code and refuses to build if any path reaches a read without an assignment.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Does not compile"><code>int neverSet;
Console.WriteLine(neverSet);</code></pre>

<pre data-lang="console" data-title="Compiler output"><code>error CS0165: Use of unassigned local variable 'neverSet'</code></pre>

  <p>This is worth appreciating rather than resenting. In some languages that variable would
  contain whatever the previous occupant of that memory left behind, and your program would run
  and produce a number that changes between executions. In C# that class of bug does not exist,
  because the compiler will not let it.</p>

  <h3>Defaults, and where they do apply</h3>

  <p class="define"><span class="define__term">Default value</span> The value a type is worth
  when nothing has been assigned. Numbers default to zero, <code>bool</code> to
  <code>false</code>, and reference types to <code>null</code>. Local variables do
  <em>not</em> get defaults — that is what definite assignment is for — but fields of an object
  do.</p>

<pre data-lang="csharp" data-net="10" data-title="01-declaring.cs"><code>Console.WriteLine($"default(int)      = {default(int)}");
Console.WriteLine($"default(decimal)  = {default(decimal)}");
Console.WriteLine($"default(bool)     = {default(bool)}");
Console.WriteLine($"default(DateTime) = {default(DateTime):O}");
Console.WriteLine($"default(string)   = null   (every reference type defaults to null)");

Settings settings = new Settings();
Console.WriteLine($"settings.MaxRetries = {settings.MaxRetries}");
Console.WriteLine($"settings.Timeout    = {settings.Timeout}");

sealed class Settings
{
    public int MaxRetries { get; set; }
    public TimeSpan Timeout { get; set; }
}</code></pre>

<pre data-lang="console" data-title="Output"><code>default(int)      = 0
default(decimal)  = 0
default(bool)     = False
default(DateTime) = 0001-01-01T00:00:00.0000000
default(string)   = null   (every reference type defaults to null)
settings.MaxRetries = 0
settings.Timeout    = 00:00:00</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Look at <code>default(DateTime)</code>: <strong>1st January, year 1</strong>. Not
    "unknown", not <code>null</code>, not today. If a record is saved with a date field nobody
    filled in, it does not stay blank — it claims the event happened two thousand years ago.
    Reports that sort or filter by date will place it first, every time, for ever.</p>
    <p>This is the general shape of default-value bugs: the default is a real, valid,
    completely wrong value, and nothing about it looks like an error. Section
    <a href="#/m/t1-02-variables-and-types::dates">Dates and times</a> below returns to this.</p>
  </div>

  <h3>Values that must not change</h3>

  <p class="define"><span class="define__term">const</span> A value fixed at compile time and
  copied into the code wherever it is used. It must be a simple literal-like value known while
  compiling.</p>

  <p class="define"><span class="define__term">readonly</span> A field that may be set once, in
  the constructor, and never afterwards. Unlike <code>const</code>, its value can be computed at
  run time.</p>

<pre data-lang="csharp" data-net="10" data-title="01-declaring.cs"><code>sealed class Money
{
    // const: burned into every assembly that uses it, at compile time.
    public const int PenceInAPound = 100;

    // readonly: set once, in the constructor, then fixed for this instance.
    public readonly int Pence;

    public Money(int pence) =&gt; Pence = pence;

    public decimal InPounds =&gt; Pence / (decimal)PenceInAPound;
}</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>A <code>const</code> is <strong>copied into every assembly that reads it, at the moment
    that assembly is compiled</strong>. If a shared library defines
    <code>public const int MaxRetries = 3;</code> and you later change it to 5, every project
    that referenced it keeps using 3 until it is <em>itself</em> rebuilt. You will change the
    value, deploy the library, and watch the old number keep appearing.</p>
    <p>Use <code>const</code> only for things that are true by definition and will never change —
    pence in a pound, days in a week. For anything that is merely a current decision, use
    <code>static readonly</code>, which is read from the library at run time.</p>
  </div>
</section>

<section id="why-types">
  <h2>Why types exist at all</h2>

  <p class="define"><span class="define__term">Type</span> A rule attached to a value that says
  three things: what it <em>means</em>, how many bytes it occupies, and which operations are
  legal on it. <code>int</code> means "a whole number in four bytes, on which addition and
  comparison make sense". <code>bool</code> means "one of exactly two values".</p>

  <p>A type earns its place by doing four jobs at once:</p>

  <ol>
    <li><strong>It fixes the size.</strong> The compiler must know how much room to reserve, and
    the processor must know how many bytes to read back.</li>
    <li><strong>It fixes the interpretation.</strong> The same bytes mean different things
    depending on type. The pattern that reads as the number 1,079,574,528 as an
    <code>int</code> is roughly 3.4 as a <code>float</code>. Without a type, bytes are only
    bytes.</li>
    <li><strong>It fixes which operations are allowed.</strong> Multiplying two numbers makes
    sense; multiplying two customers does not. The compiler enforces this before your code
    runs.</li>
    <li><strong>It documents intent to the next reader</strong>, who is often you, later.</li>
  </ol>

  <div class="callout callout--note">
    <h4>The analogy, and where it breaks</h4>
    <p>A type is like the <strong>labelled field on a paper form</strong>. A box marked
    "date of birth — DD/MM/YYYY" tells you how much room you have, what the content means, and
    that "banana" does not belong there. A clerk would reject the form.</p>
    <p>Where the analogy breaks: a clerk can accept something slightly irregular and understand
    it — "3rd of March" in a DD/MM box is fine to a human. The compiler cannot. It has no
    judgement, only rules. And unlike a form, some C# types will silently accept a value that
    does not fit and give you a <em>different</em> value back rather than refusing. That specific
    behaviour is the subject of the next two sections, and it is where the money goes
    missing.</p>
  </div>
</section>

<section id="the-built-in-types">
  <h2>The built-in types, measured</h2>

  <p>Rather than a table to memorise, here is a program that asks the runtime and prints the
  answers. The numbers below are its real output.</p>

<pre data-lang="csharp" data-net="10" data-title="02-type-sizes.cs"><code>Console.WriteLine($"{"type",-10} {"bytes",5}  {"min",32}  {"max",32}");
Console.WriteLine(new string('-', 86));

Row("byte", sizeof(byte), byte.MinValue, byte.MaxValue);
Row("sbyte", sizeof(sbyte), sbyte.MinValue, sbyte.MaxValue);
Row("short", sizeof(short), short.MinValue, short.MaxValue);
Row("ushort", sizeof(ushort), ushort.MinValue, ushort.MaxValue);
Row("int", sizeof(int), int.MinValue, int.MaxValue);
Row("uint", sizeof(uint), uint.MinValue, uint.MaxValue);
Row("long", sizeof(long), long.MinValue, long.MaxValue);
Row("ulong", sizeof(ulong), ulong.MinValue, ulong.MaxValue);
Row("float", sizeof(float), float.MinValue, float.MaxValue);
Row("double", sizeof(double), double.MinValue, double.MaxValue);
Row("decimal", sizeof(decimal), decimal.MinValue, decimal.MaxValue);

static void Row(string name, int size, object min, object max)
{
    Console.WriteLine($"{name,-10} {size,5}  {min,32}  {max,32}");
}</code></pre>

<pre data-lang="console" data-title="Output (x64)"><code>type       bytes                               min                               max
--------------------------------------------------------------------------------------
byte           1                                 0                               255
sbyte          1                              -128                               127
short          2                            -32768                             32767
ushort         2                                 0                             65535
int            4                       -2147483648                        2147483647
uint           4                                 0                        4294967295
long           8              -9223372036854775808               9223372036854775807
ulong          8                                 0              18446744073709551615
float          4                    -3.4028235E+38                     3.4028235E+38
double         8          -1.7976931348623157E+308           1.7976931348623157E+308
decimal       16    -79228162514264337593543950335     79228162514264337593543950335

bool        1 bytes
char        2 bytes  (one UTF-16 code unit)</code></pre>

  <p class="define"><span class="define__term">Integral type</span> A type holding whole numbers
  only, with no fractional part: <code>byte</code>, <code>short</code>, <code>int</code>,
  <code>long</code> and their unsigned counterparts.</p>

  <p class="define"><span class="define__term">Signed / unsigned</span> A signed type can hold
  negative values, spending one bit on the sign. An unsigned type cannot, and uses that bit for
  magnitude instead — which is why <code>uint</code> reaches about 4.29 billion where
  <code>int</code> stops at about 2.15 billion.</p>

  <p>Three numbers from that table are worth committing to memory, because they are the
  boundaries you will actually collide with:</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Limit</th><th>Value</th><th>What that means in practice</th></tr></thead>
      <tbody>
        <tr>
          <td><code>int.MaxValue</code></td>
          <td>2,147,483,647</td>
          <td>About 2.1 billion. As pence, £21,474,836.47 — reachable by a real business.</td>
        </tr>
        <tr>
          <td><code>long.MaxValue</code></td>
          <td>9,223,372,036,854,775,807</td>
          <td>About 9.2 quintillion. As pence, more money than exists. Effectively unlimited.</td>
        </tr>
        <tr>
          <td><code>decimal</code> precision</td>
          <td>28–29 significant digits</td>
          <td>Enough for any currency amount, exactly. Roughly 10× slower than <code>double</code> arithmetic.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3>Literals carry types too</h3>

  <p>A number written in your source has a type before it ever reaches a variable, decided by
  how it is written. This causes more confusion than any other single thing in this module.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>You write</th><th>Its type is</th><th>Note</th></tr></thead>
      <tbody>
        <tr><td><code>10</code></td><td><code>int</code></td><td>The default for whole numbers.</td></tr>
        <tr><td><code>10L</code></td><td><code>long</code></td><td>Needed above about 2.1 billion.</td></tr>
        <tr><td><code>10u</code></td><td><code>uint</code></td><td></td></tr>
        <tr><td><code>10.5</code></td><td><code>double</code></td><td><strong>The default for decimals is double, not decimal.</strong></td></tr>
        <tr><td><code>10.5f</code></td><td><code>float</code></td><td>Rarely the right choice on a server.</td></tr>
        <tr><td><code>10.5m</code></td><td><code>decimal</code></td><td>The <code>m</code> is for "money". Required for currency.</td></tr>
        <tr><td><code>'A'</code></td><td><code>char</code></td><td>Single quotes: one character.</td></tr>
        <tr><td><code>"A"</code></td><td><code>string</code></td><td>Double quotes: text of any length.</td></tr>
        <tr><td><code>1_000_000</code></td><td><code>int</code></td><td>Underscores are ignored; they are purely for reading.</td></tr>
      </tbody>
    </table>
  </div>

  <p>That fourth row is the one that costs money. <code>decimal price = 10.5;</code> does not
  compile, because <code>10.5</code> is a <code>double</code> and C# will not silently convert
  it. You must write <code>10.5m</code>. The compiler is protecting you here, and the temptation
  is to make the error go away by changing the variable to <code>double</code> rather than
  adding the <code>m</code>.</p>
</section>

<section id="integers">
  <h2>How integers actually behave</h2>

  <p>Two behaviours surprise people, and both produce wrong answers rather than errors.</p>

  <h3>Integer division throws away the remainder</h3>

<pre data-lang="csharp" data-net="10" data-title="03-integer-behaviour.cs"><code>int totalPence = 1000;
int customers = 3;
int shareEach = totalPence / customers;

Console.WriteLine($"1000 / 3          = {shareEach}");
Console.WriteLine($"1000 % 3          = {totalPence % customers}");
Console.WriteLine($"7 / 2             = {7 / 2}");
Console.WriteLine($"7 / 2.0           = {7 / 2.0}");
Console.WriteLine($"(double)7 / 2     = {(double)7 / 2}");
Console.WriteLine($"unallocated pence = {totalPence - (shareEach * customers)}");</code></pre>

<pre data-lang="console" data-title="Output"><code>1000 / 3          = 333
1000 % 3          = 1
7 / 2             = 3
7 / 2.0           = 3.5
(double)7 / 2     = 3.5
unallocated pence = 1</code></pre>

  <p><code>1000 / 3</code> is <strong>333</strong>, not 333.33 and not 334. The fractional part
  is discarded, always toward zero. This is not a rounding mode; nothing is rounded.</p>

  <p>Note the last line. Splitting 1000 pence between three customers and giving each 333 leaves
  <strong>one penny unaccounted for</strong>. Every system that divides money must decide where
  that penny goes, and <code>%</code> (the remainder operator) is how you find out how much is
  left. A system that ignores it will not balance.</p>

  <p>Note also <code>7 / 2.0</code>. Making <em>either</em> operand a floating-point value makes
  the whole expression floating-point. This is the standard escape from unwanted integer
  division, and the reason <code>(double)</code> appears in front of one operand so often.</p>

  <h3>Overflow wraps around, silently, by default</h3>

  <p class="define"><span class="define__term">Overflow</span> What happens when a calculation
  produces a value too large for its type. In C#, by default, the value <strong>wraps
  around</strong> to the other end of the range instead of failing.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="03-integer-behaviour.cs — this is the dashboard bug"><code>int runningTotal = int.MaxValue - 50;
Console.WriteLine($"starting at = {runningTotal:N0}");

for (int i = 0; i &lt; 100; i++)
{
    runningTotal += 1;      // no error, no warning, no exception
}

Console.WriteLine($"after +100  = {runningTotal:N0}");</code></pre>

<pre data-lang="console" data-title="Output"><code>int.MaxValue = 2,147,483,647 pence = 21,474,836.47 in pounds
starting at  = 2,147,483,597
after +100   = -2,147,483,599   &lt;-- negative. The money vanished.</code></pre>

  <p>That is the negative dashboard from the opening, exactly. A cumulative pence total stored
  in an <code>int</code> passes £21,474,836.47 and becomes a large negative number. No exception
  is thrown. No log line is written. The next report shows nonsense.</p>

  <p class="define"><span class="define__term">checked / unchecked</span> Keywords controlling
  overflow behaviour. Inside a <code>checked</code> context an overflow throws
  <code>OverflowException</code>; inside <code>unchecked</code> it wraps. <strong>Unchecked is
  the default</strong> for ordinary arithmetic.</p>

<pre data-lang="csharp" data-net="10" data-title="03-integer-behaviour.cs — the same code, guarded"><code>int guarded = int.MaxValue - 50;
try
{
    for (int i = 0; i &lt; 100; i++)
    {
        guarded = checked(guarded + 1);
    }
    Console.WriteLine($"after +100 = {guarded:N0}");
}
catch (OverflowException ex)
{
    Console.WriteLine($"threw      = {ex.GetType().Name}: {ex.Message}");
}</code></pre>

<pre data-lang="console" data-title="Output"><code>threw      = OverflowException: Arithmetic operation resulted in an overflow.</code></pre>

  <p>A loud failure you can alert on, instead of a silent one you discover from a customer. You
  can turn this on for an entire project rather than per expression, by adding one line to the
  <code>.csproj</code>:</p>

<pre data-lang="xml" data-title="Ledger.csproj"><code>&lt;PropertyGroup&gt;
  &lt;CheckForOverflowUnderflow&gt;true&lt;/CheckForOverflowUnderflow&gt;
&lt;/PropertyGroup&gt;</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: unsigned types wrap at the bottom too</h4>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>uint refunds = 0;
Console.WriteLine($"uint 0 - 1 = {unchecked(refunds - 1):N0}");</code></pre>
<pre data-lang="console"><code>uint 0 - 1 = 4,294,967,295   &lt;-- not -1</code></pre>
    <p>An unsigned type has no way to represent −1, so subtracting below zero produces its
    maximum value. This is why <code>uint</code> is a poor choice for a counter that might be
    decremented: "we can never go negative" turns into "going negative produces four
    billion". Prefer <code>int</code> and check for negatives explicitly.</p>
  </div>

  <div class="callout callout--gotcha">
    <h4>Gotcha: the sum is computed in the type of its operands</h4>
<pre data-lang="csharp" data-net="10"><code>long tooBigForInt = 3_000_000_000L;
Console.WriteLine($"int.MaxValue + 1L = {int.MaxValue + 1L:N0}");
Console.WriteLine($"int.MaxValue + 1  = {unchecked(int.MaxValue + 1):N0}");</code></pre>
<pre data-lang="console"><code>int.MaxValue + 1L = 2,147,483,648    (the L makes the whole sum long)
int.MaxValue + 1  = -2,147,483,648   (all int, so it wraps)</code></pre>
    <p>Assigning to a <code>long</code> does not help if the arithmetic was done in
    <code>int</code>. The overflow has already happened by the time the result is stored. The
    fix is to make an operand <code>long</code>, not the destination.</p>
  </div>
</section>

<section id="real-numbers">
  <h2>Fractions: the one that costs money</h2>

  <p class="define"><span class="define__term">Floating-point</span> A way of storing numbers
  with a fractional part, as a value multiplied by a power of two — much like scientific
  notation, but in base 2. <code>float</code> and <code>double</code> are floating-point types.
  They are fast because processors implement them directly in hardware.</p>

  <p class="define"><span class="define__term">IEEE 754</span> The standard that defines how
  floating-point numbers are stored and calculated. Essentially every processor and language
  implements it, which is why the behaviour below is identical in C#, Java, Python, and
  JavaScript.</p>

  <p>Because the fraction is stored in base 2, only fractions whose denominator is a power of
  two can be represented exactly. One half, one quarter, three eighths: exact. One tenth:
  <strong>not representable</strong>, in the same way one third is not representable as a finite
  decimal.</p>

<pre data-lang="csharp" data-net="10" data-title="04-floating-point.cs"><code>double a = 0.1;
double b = 0.2;

Console.WriteLine($"0.1 + 0.2           = {a + b}");
Console.WriteLine($"0.1 + 0.2 == 0.3    = {a + b == 0.3}");
Console.WriteLine($"to 20 decimals      = {(a + b).ToString("F20")}");
Console.WriteLine($"0.1 itself is       = {a.ToString("F20")}");

decimal da = 0.1m;
decimal db = 0.2m;
Console.WriteLine($"0.1m + 0.2m         = {da + db}");
Console.WriteLine($"0.1m + 0.2m == 0.3m = {da + db == 0.3m}");</code></pre>

<pre data-lang="console" data-title="Output"><code>0.1 + 0.2           = 0.30000000000000004
0.1 + 0.2 == 0.3    = False
to 20 decimals      = 0.30000000000000004441
0.1 itself is       = 0.10000000000000000555
0.1m + 0.2m         = 0.3
0.1m + 0.2m == 0.3m = True</code></pre>

  <p>The value <code>0.1</code> was never 0.1. It was 0.10000000000000000555 from the moment it
  was written. Nothing has gone wrong; the type is behaving exactly as specified. It
  cannot hold the number you asked for.</p>

  <p class="define"><span class="define__term">decimal</span> A 16-byte type that stores numbers
  in base 10 rather than base 2, with 28–29 significant digits. It represents every value a
  currency amount can take, exactly. It is roughly an order of magnitude slower than
  <code>double</code> because processors do not implement it in hardware.</p>

  <h3>The invoice that is one penny out</h3>

  <p>This is the first bug report from the opening, reproduced. Three ordinary prices, each
  rounded to the penny, then summed.</p>

<pre data-lang="csharp" data-net="10" data-title="05-ledger-money.cs"><code>(string Description, decimal UnitPrice, int Quantity)[] lines =
{
    ("Consulting, March", 2.675m, 1),
    ("Hosting, March", 1.005m, 1),
    ("Support retainer", 8.615m, 1)
};

double doubleTotal = 0.0;
decimal decimalTotal = 0m;

foreach ((string description, decimal unitPrice, int quantity) in lines)
{
    double asDouble = (double)unitPrice * quantity;
    decimal asDecimal = unitPrice * quantity;

    double roundedDouble = Math.Round(asDouble, 2, MidpointRounding.AwayFromZero);
    decimal roundedDecimal = Math.Round(asDecimal, 2, MidpointRounding.AwayFromZero);

    doubleTotal += roundedDouble;
    decimalTotal += roundedDecimal;

    Console.WriteLine($"{description,-20} {unitPrice,10} {roundedDouble,10:F2} {roundedDecimal,10:F2}");
}

Console.WriteLine($"{"TOTAL",-20} {"",10} {doubleTotal,10:F2} {decimalTotal,10:F2}");</code></pre>

<pre data-lang="console" data-title="Output"><code>line                        raw     double    decimal
------------------------------------------------------
Consulting, March         2.675       2.68       2.68
Hosting, March            1.005       1.00       1.01
Support retainer          8.615       8.62       8.62
------------------------------------------------------
TOTAL                                12.30      12.31

difference: 0.01  (1 pence)

what the double actually stored:
     2.675  -&gt;  2.67499999999999982236
     1.005  -&gt;  1.00499999999999989342
     8.615  -&gt;  8.61500000000000021316</code></pre>

  <p>Now look carefully, because the interesting part is not the penny.</p>

  <p><strong>All three prices are stored inexactly, but only one of them changed the
  answer.</strong> <code>1.005</code> is really 1.00499999…, which is genuinely below the
  midpoint, so rounding produces 1.00 rather than 1.01. Yet <code>2.675</code> is stored equally
  inexactly — 2.67499999… — and still rounded up to 2.68, because <code>Math.Round</code>
  compensates in some cases and not others.</p>

  <p>That unpredictability is the real lesson. You cannot look at a price and tell whether it
  will break. This is why the rule is <strong>never use <code>double</code> for money</strong>,
  not "be careful with doubles".</p>

  <h3>Comparison is the other casualty</h3>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="04-floating-point.cs"><code>double balance = 0.0;
for (int i = 0; i &lt; 10; i++)
{
    balance += 0.1;
}

Console.WriteLine($"0.1 added ten times = {balance.ToString("F20")}");
Console.WriteLine($"== 1.0              = {balance == 1.0}");
Console.WriteLine($"within a tolerance  = {Math.Abs(balance - 1.0) &lt; 1e-9}");</code></pre>

<pre data-lang="console" data-title="Output"><code>0.1 added ten times = 0.99999999999999988898
== 1.0              = False
within a tolerance  = True</code></pre>

  <p>A balance that should be exactly 1.00 is not equal to 1.00. In a reconciliation routine
  that waits for a difference to reach zero, this is an infinite loop or an account that never
  settles. If you must compare floating-point values, compare within a tolerance — but for
  money, use <code>decimal</code> and compare exactly.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger processes about <strong>1.2 million transactions a day</strong>. An early version
    of the settlement report summed line totals as <code>double</code> before comparing against
    the figure returned by the payment provider.</p>
    <p>Measured, running one million additions of 0.01:</p>
<pre data-lang="console"><code>expected            = 10000
double  total       = 10000.0000001719
decimal total       = 10000.00
double is off by    = 0.0000001719</code></pre>
    <p>The drift is tiny — about a fifty-thousandth of a penny across a million transactions.
    Nobody lost money. <strong>That is what made it expensive.</strong></p>
    <p>The reconciliation job compared the two totals with <code>==</code>, found them unequal,
    and flagged the batch for manual review. Every night. An operations analyst spent
    <strong>roughly 40 minutes a day</strong> confirming that a batch worth £10,000 was, in fact,
    worth £10,000 — about <strong>160 hours a year</strong> of skilled time spent re-verifying
    arithmetic that was already correct to eleven decimal places.</p>
    <p>The fix was changing one type. The cost of not fixing it was not a wrong number; it was a
    year of an analyst's attention and a permanently noisy alerting channel that people learned
    to ignore — which is how the genuinely broken batch, when it eventually arrived, sat
    unexamined for two days.</p>
  </div>
</section>

<section id="dates">
  <h2>Dates and times</h2>

  <p>Dates deserve a place here because the default choice is usually the wrong one, and the
  failure is invisible until someone in another time zone looks at your data.</p>

<pre data-lang="csharp" data-net="10" data-title="08-dates.cs"><code>DateTime unspecified = new DateTime(2026, 3, 29, 1, 30, 0);
DateTime asUtc = new DateTime(2026, 3, 29, 1, 30, 0, DateTimeKind.Utc);
DateTime asLocal = new DateTime(2026, 3, 29, 1, 30, 0, DateTimeKind.Local);

Console.WriteLine("Three DateTime values, printed the usual way:");
Console.WriteLine($"  unspecified  {unspecified}");
Console.WriteLine($"  utc          {asUtc}");
Console.WriteLine($"  local        {asLocal}");

Console.WriteLine("The same three with the round-trip format O:");
Console.WriteLine($"  unspecified  {unspecified:O}   Kind = {unspecified.Kind}");
Console.WriteLine($"  utc          {asUtc:O}   Kind = {asUtc.Kind}");
Console.WriteLine($"  local        {asLocal:O}   Kind = {asLocal.Kind}");</code></pre>

<pre data-lang="console" data-title="Output"><code>Three DateTime values, printed the usual way:
  unspecified  03/29/2026 01:30:00
  utc          03/29/2026 01:30:00
  local        03/29/2026 01:30:00
  ...indistinguishable.

The same three with the round-trip format O:
  unspecified  2026-03-29T01:30:00.0000000   Kind = Unspecified
  utc          2026-03-29T01:30:00.0000000Z   Kind = Utc
  local        2026-03-29T01:30:00.0000000+01:00   Kind = Local</code></pre>

  <p>Three values representing three different instants, printing identically. The date chosen
  is not an accident: 01:30 on 29 March 2026 is inside the hour that the UK skips when clocks go
  forward. As an unspecified local time it refers to a moment that <strong>does not
  exist</strong>.</p>

  <p><code>DateTimeOffset</code> removes the ambiguity by carrying the offset from UTC with the
  value:</p>

<pre data-lang="csharp" data-net="10" data-title="08-dates.cs"><code>DateTimeOffset london = new DateTimeOffset(2026, 6, 1, 12, 0, 0, TimeSpan.FromHours(1));
DateTimeOffset newYork = new DateTimeOffset(2026, 6, 1, 7, 0, 0, TimeSpan.FromHours(-4));

Console.WriteLine($"London  {london:O}");
Console.WriteLine($"NewYork {newYork:O}");
Console.WriteLine($"london == newYork (same instant?) -&gt; {london == newYork}");
Console.WriteLine($"london.EqualsExact(newYork)       -&gt; {london.EqualsExact(newYork)}");

DateOnly invoiceDate = new DateOnly(2026, 3, 29);
TimeOnly cutOff = new TimeOnly(17, 0);
Console.WriteLine($"DateOnly invoiceDate -&gt; {invoiceDate:O}");
Console.WriteLine($"TimeOnly cutOff      -&gt; {cutOff:O}");</code></pre>

<pre data-lang="console" data-title="Output"><code>London  2026-06-01T12:00:00.0000000+01:00
NewYork 2026-06-01T07:00:00.0000000-04:00
london == newYork (same instant?) -&gt; True
london.EqualsExact(newYork)       -&gt; False
DateOnly invoiceDate -&gt; 2026-03-29
TimeOnly cutOff      -&gt; 17:00:00.0000000</code></pre>

  <p>Noon in London and 7am in New York on that date are the <em>same instant</em>, and
  <code>==</code> says so. <code>EqualsExact</code> additionally requires the offsets to match,
  which is what you want when the local wall-clock time itself is meaningful.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Use</th><th>When</th></tr></thead>
      <tbody>
        <tr><td><code>DateTimeOffset</code></td><td><strong>The default for anything that happened.</strong> Payment timestamps, audit records, created/updated columns.</td></tr>
        <tr><td><code>DateOnly</code></td><td>A date with no time: invoice date, date of birth, a public holiday.</td></tr>
        <tr><td><code>TimeOnly</code></td><td>A time with no date: a daily cut-off, opening hours.</td></tr>
        <tr><td><code>DateTime</code></td><td>Only when an API forces it, or with <code>Kind = Utc</code> maintained rigorously throughout.</td></tr>
      </tbody>
    </table>
  </div>

  <p>Modelling an invoice date as a <code>DateTime</code> gives it a midnight time component
  that nobody intended, and midnight is precisely the value that shifts to the previous day when
  someone converts time zones. An invoice dated the 1st becomes an invoice dated the 31st of the
  previous month — and lands in the wrong tax period.</p>
</section>

<section id="conversion">
  <h2>Converting between types</h2>

  <p class="define"><span class="define__term">Implicit conversion</span> A conversion the
  compiler performs for you, without you asking, because it cannot lose information. An
  <code>int</code> fits inside a <code>long</code>, so that conversion is automatic. Also called
  <strong>widening</strong>.</p>

  <p class="define"><span class="define__term">Explicit conversion (cast)</span> A conversion
  you must request in writing, with <code>(type)value</code>, because it <em>can</em> lose
  information. Also called <strong>narrowing</strong>. The cast is you accepting
  responsibility.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="09-compile-error-probe.cs — none of these compile"><code>int truncated = 3.7;              // CS0266
long big = 3_000_000_000L;
int tooSmall = big;               // CS0266

const int PenceInAPound = 100;
PenceInAPound = 200;              // CS0131

var undecided;                    // CS0818

int duplicate = 1;
int duplicate = 2;                // CS0128</code></pre>

<pre data-lang="console" data-title="Compiler output"><code>error CS0266: Cannot implicitly convert type 'double' to 'int'. An explicit conversion exists (are you missing a cast?)
error CS0266: Cannot implicitly convert type 'long' to 'int'. An explicit conversion exists (are you missing a cast?)
error CS0131: The left-hand side of an assignment must be a variable, property or indexer
error CS0818: Implicitly-typed variables must be initialized
error CS0128: A local variable or function named 'duplicate' is already defined in this scope</code></pre>

  <p>Read CS0266 carefully, because it is the most useful error message in this list: "an
  explicit conversion exists (are you missing a cast?)". The compiler is saying <em>I can do
  this, but it might lose data, so say so explicitly</em>. Adding <code>(int)</code> makes it
  compile — and silently truncates 3.7 to 3. The cast is not a fix; it is a signature accepting
  the loss.</p>

  <h3>Parsing text, and the bug that only happens abroad</h3>

  <p class="define"><span class="define__term">Parsing</span> Turning text into a typed value —
  <code>"1.234"</code> into the number 1.234.</p>

  <p class="define"><span class="define__term">Culture</span> A set of regional conventions: the
  decimal separator, the thousands separator, date order, currency symbol. .NET uses the
  operating system's culture by default for parsing and formatting.</p>

  <p>That default is the third bug from the opening.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="06-parsing-and-culture.cs"><code>foreach (string name in new[] { "en-GB", "en-US", "de-DE", "fr-FR" })
{
    CultureInfo culture = CultureInfo.GetCultureInfo(name);
    bool ok = decimal.TryParse("1.234", NumberStyles.Number, culture, out decimal value);
    string result = ok ? value.ToString(CultureInfo.InvariantCulture) : "REJECTED";
    Console.WriteLine($"  {name,-6} -&gt; {result,12}");
}</code></pre>

<pre data-lang="console" data-title="Output"><code>parsing "1.234"   (a price: one pound twenty-three)

  en-GB  -&gt;        1.234
  en-US  -&gt;        1.234
  de-DE  -&gt;         1234
  fr-FR  -&gt;     REJECTED
  Inv.   -&gt;        1.234</code></pre>

  <p>One string. Three different outcomes. On a German-locale server, <code>"1.234"</code>
  parses <strong>successfully</strong> as one thousand two hundred and thirty-four, because
  de-DE reads <code>.</code> as a thousands separator. That is a <strong>1000× error</strong>,
  and nothing throws, nothing is logged, and no test on an English-locale machine will ever
  catch it.</p>

  <p>Formatting has the same problem in reverse:</p>

<pre data-lang="console" data-title="Output"><code>  1234.5 written by en-GB  -&gt; 1,234.50
  1234.5 written by de-DE  -&gt; 1.234,50
  1234.5 written by fr-FR  -&gt; 1 234,50
  1234.5 written by Invariant -&gt; 1,234.50</code></pre>

  <p>A German-locale service writes <code>1.234,50</code> into a CSV; a British-locale service
  reads it back as 1.234. The round trip corrupts the data, and both machines behaved
  correctly.</p>

  <p class="define"><span class="define__term">Invariant culture</span> A fixed, region-neutral
  set of conventions that never varies with the machine. It is what you use for any value that
  crosses a boundary between machines: files, APIs, databases, logs.</p>

<pre data-lang="csharp" data-net="10" data-title="The rule"><code>// For data exchanged with other systems: always specify InvariantCulture.
if (decimal.TryParse(input, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal value))
{
    // use value
}

// For text a human will read on screen: the user's culture is correct.
Console.WriteLine(value.ToString("C", CultureInfo.CurrentCulture));</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: Parse versus TryParse</h4>
    <p><code>decimal.Parse</code> throws <code>FormatException</code> on bad input.
    <code>decimal.TryParse</code> returns <code>false</code> and sets the output to zero.</p>
<pre data-lang="console"><code>TryParse('not a number') -&gt; False
Parse('not a number')    -&gt; throws FormatException</code></pre>
    <p>Use <code>TryParse</code> for anything that came from outside your program — user input,
    a file, an HTTP request — where invalid data is a normal occurrence rather than a bug. Use
    <code>Parse</code> only when invalid input genuinely means the program is broken.</p>
    <p>The trap in <code>TryParse</code>: when it fails it sets the result to
    <strong>zero</strong>, not to something clearly invalid. Ignoring the returned
    <code>bool</code> gives you a silent zero, which for a price or a quantity is a very
    plausible-looking wrong answer.</p>
  </div>
</section>

<section id="var">
  <h2><code>var</code> and type inference</h2>

  <p class="define"><span class="define__term">var</span> A keyword that tells the compiler to
  work out the type from the right-hand side of the assignment. The variable still has one
  fixed type, decided at compile time, and it can never change.</p>

  <p class="define"><span class="define__term">Type inference</span> The compiler deducing a
  type you did not write out.</p>

  <p><code>var</code> is not "any type", not a variant, and not dynamic typing. It is pure
  shorthand. <code>var count = 10;</code> and <code>int count = 10;</code> compile to identical
  code.</p>

<pre data-lang="csharp" data-net="10" data-title="07-var-inference.cs"><code>var count = 10;              // int
var price = 10.5;            // double, NOT decimal
var money = 10.5m;           // decimal
var ratio = 1 / 2;           // int -&gt; 0
var better = 1 / 2.0;        // double -&gt; 0.5
var flag = true;             // bool
var letter = 'A';            // char
var text = "A";              // string
var numbers = new[] { 1, 2, 3 };

Console.WriteLine($"{"var count = 10",-22} {count.GetType().Name,-12} {count}");
Console.WriteLine($"{"var price = 10.5",-22} {price.GetType().Name,-12} {price}");
Console.WriteLine($"{"var money = 10.5m",-22} {money.GetType().Name,-12} {money}");
Console.WriteLine($"{"var ratio = 1 / 2",-22} {ratio.GetType().Name,-12} {ratio}");
Console.WriteLine($"{"var better = 1 / 2.0",-22} {better.GetType().Name,-12} {better}");</code></pre>

<pre data-lang="console" data-title="Output"><code>expression             inferred type value
----------------------------------------------------
var count = 10         Int32        10
var price = 10.5       Double       10.5
var money = 10.5m      Decimal      10.5
var ratio = 1 / 2      Int32        0
var better = 1 / 2.0   Double       0.5
var flag = true        Boolean      True
var letter = 'A'       Char         A
var text = "A"         String       A
var numbers = new[]{1,2,3} Int32[]      3 items</code></pre>

  <p>The trap is on the fourth row and it is worth staring at:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="VAT is now zero"><code>var vatRate = 20 / 100;      // int division -&gt; 0
var total = subtotal * vatRate;   // every invoice has no VAT</code></pre>

<pre data-lang="console" data-title="Output"><code>var vatRate = 20 / 100;      -&gt; 0      (int division, VAT is now zero)
var vatRate = 20 / 100m;     -&gt; 0.2    (decimal, correct)
var vatRate = 0.2m;          -&gt; 0.2    (clearest of the three)</code></pre>

  <p>Writing <code>decimal vatRate = 20 / 100;</code> would have produced a compile error,
  because the <code>int</code> result 0 is being assigned to a <code>decimal</code>... except it
  would not, because 0 converts to decimal cleanly. The type annotation would not have saved
  you. What saves you is knowing that <code>/</code> on two integers is integer division.</p>

  <div class="callout callout--note">
    <h4>A usable rule for var</h4>
    <p>Use <code>var</code> when the type is obvious from the right-hand side —
    <code>var customer = new Customer();</code> — where writing the type twice adds nothing.</p>
    <p>Write the type explicitly when the right-hand side is a method call whose return type is
    not obvious from its name, and <strong>always for numeric types where precision
    matters</strong>. <code>decimal total = ...</code> states an intention that
    <code>var total = ...</code> leaves to the reader to reconstruct.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Money in a floating-point type</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>public class Invoice
{
    public double Subtotal { get; set; }
    public double Vat { get; set; }
    public double Total { get; set; }
}</code></pre>

  <p>Symptoms: totals a penny out; reconciliation never balancing; <code>==</code> comparisons
  failing on values that print identically. The fix is <code>decimal</code> everywhere money
  appears, including the database column type and any DTO crossing a service boundary. Changing
  half the pipeline is worse than changing none of it, because the conversion point becomes
  invisible.</p>

  <h3>2. A counter or an amount in an <code>int</code></h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>public int TotalPenceProcessed { get; set; }   // overflows at £21,474,836.47</code></pre>

  <p>Symptoms: large negative numbers appearing in reports, with no exception anywhere. Use
  <code>long</code> for accumulating counters and <code>decimal</code> for money. Enable
  <code>CheckForOverflowUnderflow</code> so the failure is loud.</p>

  <h3>3. Parsing or formatting without a culture</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>decimal price = decimal.Parse(row["price"]);          // uses the machine's culture
string csv = $"{amount},{quantity},{DateTime.Now}";  // writes in the machine's culture</code></pre>

  <p>Symptoms: works in one region, wrong by 1000× in another; CSV files that round-trip
  incorrectly; dates read as month/day in one place and day/month in another. Always pass
  <code>CultureInfo.InvariantCulture</code> for machine-readable data.</p>

  <h3>4. <code>DateTime</code> where the instant matters</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>public DateTime PaidAt { get; set; } = DateTime.Now;   // no offset, and local to this server</code></pre>

  <p>Symptoms: timestamps an hour out twice a year; events appearing out of order across
  regions; a duplicated hour in October where two different instants share a timestamp. Use
  <code>DateTimeOffset</code> and <code>DateTimeOffset.UtcNow</code>.</p>

  <h3>5. Ignoring the result of <code>TryParse</code></h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>decimal.TryParse(input, out decimal amount);   // return value discarded
ChargeCustomer(amount);                        // charges 0.00 on bad input</code></pre>

  <p>Symptoms: zero-value transactions; quantities silently becoming zero. The compiler will not
  warn you, because ignoring a return value is legal. Always branch on it.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>Symptom: a total is out by a penny or two</h4>
    <ol>
      <li><strong>Find the type first, before reading any logic.</strong> Go to definition on the
      total and every value feeding it. If any is <code>double</code> or <code>float</code>, stop
      looking at the arithmetic — you have found it.</li>
      <li><strong>Print the full precision.</strong> The default <code>ToString()</code> hides
      the problem by rounding for display. Use <code>ToString("F20")</code> or
      <code>ToString("R")</code> to see what is actually stored:
<pre data-lang="csharp" data-net="10"><code>Console.WriteLine(suspectValue.ToString("F20"));</code></pre>
      A value ending in a long tail of 9s or 0s followed by stray digits confirms it.</li>
      <li><strong>Check the whole path,</strong> not only the calculation: the database column
      type (<code>float</code> and <code>real</code> in SQL Server are binary floating-point;
      <code>decimal</code>/<code>numeric</code> are not), the DTO, and any JSON deserialisation,
      which will happily land a currency amount in a <code>double</code>.</li>
      <li><strong>Fix by converting the entire path to <code>decimal</code></strong>, then add a
      test that sums values known to be awkward — 1.005, 2.675, 0.1 ten times.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: a number is negative, or absurdly large, and should not be</h4>
    <ol>
      <li><strong>Compare against the type's limits.</strong> Is the wrong value near
      <code>int.MinValue</code> (−2,147,483,648) or <code>uint.MaxValue</code>
      (4,294,967,295)? Those two numbers are fingerprints of overflow, not coincidences.</li>
      <li><strong>Reproduce with a <code>checked</code> block</strong> around the suspect
      arithmetic. If it throws <code>OverflowException</code>, you have confirmed it in one
      step.</li>
      <li><strong>Turn it on everywhere</strong> in a test build by setting
      <code>&lt;CheckForOverflowUnderflow&gt;true&lt;/CheckForOverflowUnderflow&gt;</code>, then
      run the test suite. Every silent wraparound becomes a failing test.</li>
      <li><strong>Fix by widening the type</strong> — <code>int</code> to <code>long</code> — and
      remember to widen an <em>operand</em>, not only the destination.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: correct on one machine, wrong on another</h4>
    <ol>
      <li><strong>Compare cultures</strong> before anything else:
<pre data-lang="csharp" data-net="10"><code>Console.WriteLine(CultureInfo.CurrentCulture.Name);
Console.WriteLine(CultureInfo.CurrentCulture.NumberFormat.NumberDecimalSeparator);
Console.WriteLine(TimeZoneInfo.Local.Id);</code></pre>
      </li>
      <li><strong>Reproduce locally by forcing the culture</strong> rather than trying to obtain
      the other machine:
<pre data-lang="csharp" data-net="10"><code>CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");</code></pre>
      </li>
      <li><strong>Prevent the whole class of bug</strong> by setting the invariant culture at
      application start, so no code path can accidentally depend on the machine, and passing an
      explicit culture only where a human will read the output:
<pre data-lang="csharp" data-net="10"><code>CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;</code></pre>
      </li>
      <li><strong>Or remove the ambiguity at the source:</strong> set
      <code>&lt;InvariantGlobalization&gt;true&lt;/InvariantGlobalization&gt;</code> in the
      project file for a service that never needs regional formatting.</li>
    </ol>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>double</code> is fine for money if I round at the end."</strong></p>
    <p>Demonstrated false above: the three-line invoice was a penny out <em>after</em> rounding
    each line to two decimal places. Rounding does not remove the error; it decides which side
    of the boundary an already-wrong value falls on, and 1.005 fell the wrong way while 2.675
    did not. You cannot predict which values will break.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>decimal</code> is only a bigger <code>double</code>."</strong></p>
    <p>They differ in <em>base</em>, not only size. <code>double</code> stores a number as a
    power of two, so one tenth is unrepresentable. <code>decimal</code> stores it as a power of
    ten, so every value with 28 or fewer significant digits and a sensible exponent is exact.
    <code>decimal</code> is also 16 bytes to <code>double</code>'s 8, and roughly an order of
    magnitude slower, because processors implement <code>double</code> in hardware and
    <code>decimal</code> in software. It has a much smaller <em>range</em> — around 7.9×10²⁸
    against 1.8×10³⁰⁸ — which is why scientific work uses <code>double</code> and finance uses
    <code>decimal</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>var</code> makes C# dynamically typed."</strong></p>
    <p>No. The type is decided at compile time from the right-hand side and fixed permanently.
    <code>var count = 10; count = "ten";</code> is a compile error, exactly as
    <code>int count = 10;</code> would be. <code>var</code> saves typing and nothing else. The
    genuinely dynamic keyword is <code>dynamic</code>, which is a different feature and rarely
    the right answer.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Use <code>uint</code> for things that cannot be negative — it documents
    intent."</strong></p>
    <p>It documents intent and then betrays it. Subtracting past zero produces 4,294,967,295
    rather than an error, so "cannot be negative" becomes "silently becomes four billion".
    Unsigned types also convert awkwardly with the rest of the framework, which uses
    <code>int</code> for counts and lengths. Use <code>int</code> and validate explicitly.
    Reserve unsigned types for bit manipulation and interoperating with external formats.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Silencing a conversion error with a cast.</strong></p>
    <p>CS0266 says a conversion may lose data. Writing <code>(int)</code> makes the message go
    away and keeps the data loss. If the compiler objects to a narrowing conversion, the
    question to ask is "which of these two types is wrong?", not "how do I make this
    compile?".</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong><code>DateTime.Now</code> as a default.</strong></p>
    <p><code>DateTime.Now</code> is the local time of whichever server happens to run the code,
    with no offset recorded. In a service that scales across regions this produces timestamps
    that cannot be ordered. Use <code>DateTimeOffset.UtcNow</code>, and inject a clock
    abstraction if you want the value to be testable.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing a type, in practice</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>What you are storing</th><th>Use</th><th>Because</th></tr></thead>
      <tbody>
        <tr><td>Money, prices, tax, any currency amount</td><td><code>decimal</code></td><td>Exact in base 10. The one non-negotiable rule in this module.</td></tr>
        <tr><td>A count of things</td><td><code>int</code></td><td>The framework's default for counts and lengths; converts everywhere without friction.</td></tr>
        <tr><td>A cumulative or ever-growing total</td><td><code>long</code></td><td><code>int</code> overflows at 2.1 billion, which real systems reach.</td></tr>
        <tr><td>A database identifier</td><td><code>long</code> or <code>Guid</code></td><td>Running out of <code>int</code> identifiers in production is a painful migration.</td></tr>
        <tr><td>Scientific or statistical values, physics, graphics</td><td><code>double</code></td><td>Enormous range, hardware speed, and exactness is not expected.</td></tr>
        <tr><td>A percentage or rate used in money maths</td><td><code>decimal</code></td><td>It multiplies a currency amount, so it must not reintroduce binary error.</td></tr>
        <tr><td>When something happened</td><td><code>DateTimeOffset</code></td><td>Records the instant unambiguously.</td></tr>
        <tr><td>A calendar date with no time</td><td><code>DateOnly</code></td><td>No midnight component to shift across time zones.</td></tr>
        <tr><td>A yes/no</td><td><code>bool</code></td><td>Two values, no third state. If you need "unknown", use <code>bool?</code>.</td></tr>
        <tr><td>Text</td><td><code>string</code></td><td>Covered in depth in <a href="#/m/t1-07-strings-and-interning">Strings, Immutability, and Interning</a>.</td></tr>
        <tr><td>A value that may be absent</td><td><code>int?</code>, <code>DateOnly?</code></td><td>A <strong>nullable value type</strong>: the type plus a flag saying whether it has a value. Better than a magic 0 or −1.</td></tr>
      </tbody>
    </table>
  </div>

  <p class="define"><span class="define__term">Nullable value type</span> Written
  <code>int?</code>. A <em>value type</em> is one whose variable holds the data itself — every
  type in this module except <code>string</code> is one, and
  <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> takes that apart
  properly. Adding <code>?</code> makes it hold either a normal value or "no value at all". Use
  it instead of choosing a real number to mean "missing" — a sentinel like −1 or 0 will
  eventually be treated as data by code that has forgotten the convention.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Predict the output of each line before running it, then explain in one sentence what rule
    produced it.</p>
<pre data-lang="csharp" data-net="10"><code>Console.WriteLine(7 / 2);
Console.WriteLine(7 % 2);
Console.WriteLine(7 / 2.0);
Console.WriteLine(0.1 + 0.2 == 0.3);
Console.WriteLine(0.1m + 0.2m == 0.3m);
Console.WriteLine(default(int));

int max = int.MaxValue;
Console.WriteLine(max + 1);</code></pre>

    <p>Then answer a follow-up: why does the last pair of lines need the variable? What happens
    if you write <code>Console.WriteLine(int.MaxValue + 1);</code> directly?</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Line</th><th>Output</th><th>Rule</th></tr></thead>
            <tbody>
              <tr><td><code>7 / 2</code></td><td><code>3</code></td><td>Both operands are <code>int</code>, so this is integer division and the remainder is discarded.</td></tr>
              <tr><td><code>7 % 2</code></td><td><code>1</code></td><td><code>%</code> gives the remainder that division threw away.</td></tr>
              <tr><td><code>7 / 2.0</code></td><td><code>3.5</code></td><td>One operand is a <code>double</code>, so the whole expression is evaluated as <code>double</code>.</td></tr>
              <tr><td><code>0.1 + 0.2 == 0.3</code></td><td><code>False</code></td><td>None of the three is exactly representable in base 2; the sum lands on 0.30000000000000004.</td></tr>
              <tr><td><code>0.1m + 0.2m == 0.3m</code></td><td><code>True</code></td><td><code>decimal</code> is base 10, so all three values are exact.</td></tr>
              <tr><td><code>default(int)</code></td><td><code>0</code></td><td>Numeric types default to zero.</td></tr>
              <tr><td><code>max + 1</code></td><td><code>-2147483648</code></td><td>Runtime arithmetic is unchecked by default, so it wraps to <code>int.MinValue</code>.</td></tr>
            </tbody>
          </table>
        </div>

        <p><strong>The follow-up, which is the interesting half.</strong> Writing
        <code>Console.WriteLine(int.MaxValue + 1);</code> directly does not compile at all:</p>
<pre data-lang="console" data-title="Compiler output"><code>error CS0220: The operation overflows at compile time in checked mode</code></pre>
        <p>Both operands are compile-time constants, so the compiler evaluates the expression
        while building — and <strong>constant expressions are checked by default</strong>, which
        is the opposite of the rule for ordinary runtime arithmetic. The compiler catches the
        overflow and refuses.</p>
        <p>Putting the value in a variable first makes it a runtime expression. The compiler can
        no longer fold it, the default unchecked rule applies, and it wraps silently — which is
        exactly what happens in real code, where the operands come from a database or an HTTP
        request rather than from a literal.</p>
        <p>This asymmetry is worth carrying with you: <strong>the compiler protects you from
        overflow only in the one case where you did not need protecting</strong>, because you
        could see the numbers. Wrap the constant version in <code>unchecked(...)</code> and it
        compiles and wraps, if you genuinely want that.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This type is used to represent a payment in a live system. It contains at least five
    problems covered in this module. Find them, say what each one causes, and rewrite it.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public class Payment
{
    public int Id { get; set; }
    public double Amount { get; set; }
    public float TaxRate { get; set; }
    public DateTime ProcessedAt { get; set; }
    public int TotalPenceToDate { get; set; }

    public double CalculateTax() =&gt; Amount * TaxRate;

    public static Payment FromCsvRow(string[] row) =&gt; new Payment
    {
        Id = int.Parse(row[0]),
        Amount = double.Parse(row[1]),
        TaxRate = float.Parse(row[2]),
        ProcessedAt = DateTime.Parse(row[3])
    };
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>1. <code>Amount</code> is a <code>double</code>.</strong> Currency in a binary
        floating-point type. Totals will be pennies out and equality comparisons will fail on
        values that print identically.</p>

        <p><strong>2. <code>TaxRate</code> is a <code>float</code>.</strong> Worse than
        <code>double</code> — only about 7 significant digits. It multiplies a currency amount,
        so its error propagates straight into money.</p>

        <p><strong>3. <code>ProcessedAt</code> is a <code>DateTime</code>.</strong> No offset is
        recorded, so the instant is ambiguous. Two servers in different regions produce
        timestamps that cannot be ordered, and the value shifts by an hour twice a year.</p>

        <p><strong>4. <code>TotalPenceToDate</code> is an <code>int</code>.</strong> A cumulative
        total overflows at 2,147,483,647 pence — £21,474,836.47 — and silently goes negative.</p>

        <p><strong>5. Every <code>Parse</code> call is culture-dependent and throwing.</strong>
        Culture-dependent: <code>"1.234"</code> becomes 1234 on a German-locale server.
        Throwing: one malformed row takes down the whole import with a
        <code>FormatException</code> rather than rejecting that row.</p>

        <p><strong>6. (Bonus) <code>Id</code> is an <code>int</code>.</strong> Not wrong today,
        but running out of identifiers is a migration nobody enjoys. <code>long</code> costs four
        extra bytes per row.</p>

        <p>The rewrite:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>using System.Globalization;

public sealed class Payment
{
    public required long Id { get; init; }
    public required decimal Amount { get; init; }
    public required decimal TaxRate { get; init; }
    public required DateTimeOffset ProcessedAt { get; init; }
    public required long TotalPenceToDate { get; init; }

    public decimal CalculateTax() =&gt;
        Math.Round(Amount * TaxRate, 2, MidpointRounding.AwayFromZero);

    public static bool TryFromCsvRow(string[] row, out Payment? payment)
    {
        payment = null;
        if (row.Length &lt; 4)
        {
            return false;
        }

        CultureInfo invariant = CultureInfo.InvariantCulture;

        if (!long.TryParse(row[0], NumberStyles.Integer, invariant, out long id) ||
            !decimal.TryParse(row[1], NumberStyles.Number, invariant, out decimal amount) ||
            !decimal.TryParse(row[2], NumberStyles.Number, invariant, out decimal taxRate) ||
            !DateTimeOffset.TryParse(row[3], invariant, DateTimeStyles.RoundtripKind, out DateTimeOffset processedAt))
        {
            return false;
        }

        payment = new Payment
        {
            Id = id,
            Amount = amount,
            TaxRate = taxRate,
            ProcessedAt = processedAt,
            TotalPenceToDate = 0
        };
        return true;
    }
}</code></pre>
        <p>Note what else changed. <code>init</code> and <code>required</code> mean a
        <code>Payment</code> cannot exist in a half-populated state, and
        <code>TryFromCsvRow</code> rejects a bad row rather than throwing, so one malformed line
        does not abort a ten-thousand-row import. Rounding is explicit and stated, rather than
        left to whatever the caller does next.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>An import job reads a CSV produced by a partner in Germany. It runs green in CI in London
    and produces wrong values in production in Frankfurt. Write a test that fails on a London
    machine, demonstrating the bug without needing a German server — then fix the code.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public static decimal ReadAmount(string field) =&gt; decimal.Parse(field);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>The key insight is that you do not need the other machine. The culture is a property
        of the thread, so you can impersonate Frankfurt in a test.</p>
<pre data-lang="csharp" data-net="10" data-title="The failing test"><code>using System.Globalization;

// Runs on any machine, in any country, and fails against the broken code.
public static void ParsingIsIndependentOfMachineCulture()
{
    CultureInfo original = CultureInfo.CurrentCulture;
    try
    {
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");

        decimal parsed = ReadAmount("1.234");

        if (parsed != 1.234m)
        {
            throw new Exception($"expected 1.234 but got {parsed.ToString(CultureInfo.InvariantCulture)}");
        }
    }
    finally
    {
        CultureInfo.CurrentCulture = original;
    }
}</code></pre>
        <p>Against the broken implementation this reports
        <code>expected 1.234 but got 1234</code>. The fix:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>using System.Globalization;

public static decimal ReadAmount(string field)
{
    if (!decimal.TryParse(field, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal value))
    {
        throw new FormatException($"'{field}' is not a valid amount.");
    }
    return value;
}</code></pre>
        <p>Two things changed. <code>InvariantCulture</code> makes the result independent of
        where the code runs. <code>TryParse</code> plus an explicit throw gives a message naming
        the offending field, instead of <code>decimal.Parse</code>'s generic
        <code>FormatException</code> that tells you nothing about which of ten thousand rows was
        bad.</p>
        <p><strong>The wider point:</strong> the original code was not tested wrongly, it was
        untestable in the dimension that mattered. Any behaviour that depends on ambient machine
        state — culture, time zone, current time — should be forced explicitly in tests, because
        CI runs in exactly one configuration and production may not match it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A subscription service must split a monthly charge between three cost centres, in
    proportion to usage, and the parts must sum exactly to the charge. Write
    <code>Split</code> so that no money is created or destroyed, then explain why the obvious
    implementation fails and how you decided where the remainder goes.</p>
<pre data-lang="csharp" data-net="10"><code>// Split 100.00 in the ratios 1 : 1 : 1
// Split  10.00 in the ratios 1 : 2 : 3
// In both cases the returned amounts must sum exactly to the input.
public static decimal[] Split(decimal amount, int[] weights)
{
    throw new NotImplementedException();
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why the obvious version fails.</strong> Computing each share as
        <code>amount * weight / totalWeight</code> and rounding each to two decimal places gives
        £33.33 three times for £100.00, summing to £99.99. One penny has been destroyed. Rounding
        the other way creates a penny instead. Because a third of 100 is not representable in any
        finite decimal, <em>no</em> rounding rule applied independently to each share can be made
        to sum correctly — the error has to be handled globally, not per share.</p>

        <p><strong>The technique</strong> is to allocate by running total: compute the cumulative
        boundary at each step, round <em>that</em>, and take each share as the difference between
        consecutive boundaries. Rounding errors cancel because every boundary except the last is
        used twice, once positively and once negatively, and the last boundary is the exact
        total.</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>using System.Globalization;

public static decimal[] Split(decimal amount, int[] weights)
{
    ArgumentNullException.ThrowIfNull(weights);
    if (weights.Length == 0)
    {
        throw new ArgumentException("At least one weight is required.", nameof(weights));
    }

    long totalWeight = 0;
    foreach (int weight in weights)
    {
        if (weight &lt; 0)
        {
            throw new ArgumentException("Weights cannot be negative.", nameof(weights));
        }
        totalWeight += weight;
    }

    if (totalWeight == 0)
    {
        throw new ArgumentException("Weights cannot all be zero.", nameof(weights));
    }

    decimal[] parts = new decimal[weights.Length];
    long runningWeight = 0;
    decimal previousBoundary = 0m;

    for (int i = 0; i &lt; weights.Length; i++)
    {
        runningWeight += weights[i];

        // The exact cumulative amount owed after this share, rounded once.
        decimal boundary = i == weights.Length - 1
            ? amount                                     // the last boundary is the whole amount
            : Math.Round(amount * runningWeight / totalWeight, 2, MidpointRounding.ToEven);

        parts[i] = boundary - previousBoundary;
        previousBoundary = boundary;
    }

    return parts;
}</code></pre>
        <p>Driving it:</p>
<pre data-lang="csharp" data-net="10"><code>Check(100.00m, new[] { 1, 1, 1 });
Check(10.00m, new[] { 1, 2, 3 });
Check(0.01m, new[] { 1, 1, 1 });

static void Check(decimal amount, int[] weights)
{
    decimal[] parts = Split(amount, weights);
    decimal sum = 0m;
    foreach (decimal part in parts)
    {
        sum += part;
    }

    Console.WriteLine($"{amount} split {string.Join(":", weights)} -&gt; " +
        $"{string.Join(", ", parts)}  sum = {sum}  exact = {sum == amount}");
}</code></pre>
<pre data-lang="console" data-title="Output"><code>100.00 split 1:1:1 -&gt; 33.33, 33.34, 33.33  sum = 100.00  exact = True
10.00 split 1:2:3 -&gt; 1.67, 3.33, 5.00  sum = 10.00  exact = True
0.01 split 1:1:1 -&gt; 0.00, 0.01, 0.00  sum = 0.01  exact = True</code></pre>

        <p><strong>Where the remainder actually goes — and why the obvious guess is wrong.</strong>
        Look at the first line. The extra penny lands on the <em>middle</em> party, not the last.
        That surprises most people, including the author of this module before running it.</p>
        <p>The reason is that this method never hands the remainder to a chosen party. Each share
        is the gap between two rounded cumulative boundaries, so the leftover penny appears
        wherever the rounding of those boundaries happens to place it. For 100.00 the boundaries
        round to 33.33 and 66.67, making the middle share 33.34.</p>
        <p>What the method <em>does</em> guarantee is the part that matters: the shares sum
        exactly to the input, always, and the result is deterministic for a given input — the
        same invoice recomputed next year produces the same split.</p>
        <p><strong>If you need the remainder to go somewhere specific, that is a separate,
        deliberate step</strong> — give it to the largest share, or rotate it between parties
        across billing periods so nobody is systematically short-changed. Both are used in
        practice. What is not defensible is leaving it undecided, which is how a ledger fails to
        balance by a penny a month until somebody reconciles a year of statements.</p>
        <p>Note the third case: splitting a single penny three ways gives two parties nothing.
        That is correct — a penny cannot be divided — and it is exactly the kind of edge case
        worth a test, because the naive implementation returns three zeros and quietly loses the
        penny.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does <code>1000 / 3</code> evaluate to in C#, and how do you find what was lost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>333.</strong> Both operands are <code>int</code>, so integer division discards
        the fractional part rather than rounding. <code>1000 % 3</code> gives the remainder,
        <code>1</code>. Making either operand floating-point — <code>1000 / 3.0</code> — performs
        the division you probably meant.</p>
      </div></details>
    </li>
    <li>
      <p>Why must money never be stored in a <code>double</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>double</code> stores numbers in base 2, so values like 0.1 and 1.005 have no
        exact representation — 0.1 is really 0.10000000000000000555. The error changes rounding
        results unpredictably (1.005 rounded down while 2.675 rounded up in the same run) and
        breaks equality comparisons. Use <code>decimal</code>, which is base 10 and exact for
        currency amounts.</p>
      </div></details>
    </li>
    <li>
      <p>What happens when an <code>int</code> exceeds its maximum, and how do you make it fail
      loudly?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It <strong>wraps around</strong> to <code>int.MinValue</code> silently — arithmetic is
        unchecked by default. Wrap the expression in <code>checked(...)</code> to get an
        <code>OverflowException</code>, or set
        <code>&lt;CheckForOverflowUnderflow&gt;true&lt;/CheckForOverflowUnderflow&gt;</code> to
        apply it to the whole project.</p>
      </div></details>
    </li>
    <li>
      <p>Why can the same string parse to different numbers on two servers, and what prevents
      it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Parsing uses the machine's <strong>culture</strong> by default, and cultures disagree
        about which character is the decimal separator. <code>"1.234"</code> is 1.234 in en-GB and
        <strong>1234</strong> in de-DE — a 1000× error with no exception. Pass
        <code>CultureInfo.InvariantCulture</code> explicitly for any value crossing a machine
        boundary.</p>
      </div></details>
    </li>
    <li>
      <p>Does <code>var</code> make a variable's type flexible?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. <code>var</code> asks the compiler to infer the type from the right-hand side at
        compile time; the variable is then that type permanently.
        <code>var count = 10; count = "ten";</code> is a compile error. Note that
        <code>var price = 10.5;</code> infers <code>double</code>, not <code>decimal</code> —
        write <code>10.5m</code> for money.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>DateTimeOffset</code> the default choice over <code>DateTime</code> for
      recording when something happened?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>DateTime</code> carries a <code>Kind</code> that is easily lost in storage or
        serialisation, after which the same value could mean UTC, local, or unspecified — three
        different instants that print identically. <code>DateTimeOffset</code> stores the offset
        from UTC alongside the value, so the instant is unambiguous and values from different
        regions compare correctly.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>const</code> a risky choice for a value shared between projects?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <code>const</code> is copied into every assembly that reads it, at the moment that
        assembly is compiled. Changing it and redeploying the library does not change the value
        in consumers until each is rebuilt. Use <code>static readonly</code> for anything that is
        a current decision rather than a definition.</p>
      </div></details>
    </li>
  </ol>

  <div class="callout callout--note">
    <h4>Where this leads</h4>
    <p><a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> explains where
    the values in this module physically live and what happens when you copy them —
    <code>decimal</code>, <code>int</code>, and <code>DateTimeOffset</code> all behave one way
    and <code>string</code> another.
    <a href="#/m/t1-16-equality-and-hashing">Equality, GetHashCode, and Comparers</a> takes the
    equality problems here much further.
    <a href="#/m/t1-07-strings-and-interning">Strings, Immutability, and Interning</a> covers the
    one built-in type this module deliberately skimmed, and
    <a href="#/m/t4-01-relational-modelling">Relational Modelling From Scratch</a> is where these
    choices meet database column types, which is where a <code>decimal</code> in C# can still
    become a <code>float</code> on disk.</p>
  </div>
</section>

`
});
