/* ============================================================================
   Track 1, Module 5 — Methods, Arguments, and Parameters
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-05-methods-and-parameters/.
   ========================================================================= */

CSPREP.module({
  id: "t1-05-methods-and-parameters",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "A method is a named, reusable block of behaviour — and the way you declare its parameters " +
    "is a contract you cannot quietly change later. Optional defaults get copied into your " +
    "callers, parameter names become part of your public API, and every call costs stack.",
  terms: [
    "method", "parameter", "argument", "return type", "signature", "void",
    "call stack", "stack frame", "recursion", "base case", "stack overflow",
    "overload", "overload resolution", "local function", "expression-bodied member",
    "ref", "out", "in", "optional parameter", "named argument", "params",
    "inlining", "binary compatibility"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A payments team ships a small fix. Their shared fee library had a default fee of 2%, agreed
  years ago; the business has decided it should now be 5%. One developer changes the default,
  the library version is bumped, and every service that depends on it picks up the new package
  in the next deployment.</p>

  <p>Two of the eleven services keep charging 2%.</p>

  <p>Not intermittently. Consistently, and only those two. Their logs show them loading the new
  library version. Ask the library at run time what its default is and it correctly answers 5%.
  The fee applied is still 2%. Nothing is cached, nothing is misconfigured, and the two services
  have nothing visibly in common.</p>

  <p>Separately, the same week: a background job that has run nightly for a year suddenly dies
  without a stack trace, without an entry in the error log, and without the exception handler
  wrapped around it firing at all. The process is not there any more.</p>

  <p>Both of these come from the same place — <strong>how a method's parameters are declared,
  and what that commits you to</strong>. A method looks like the most ordinary thing in
  programming. Its parameter list is a contract with everyone who calls it, parts of that
  contract are copied into the caller at compile time, and one of the failure modes cannot be
  caught.</p>
</section>

<section id="what-a-method-is">
  <h2>What a method actually is</h2>

  <p>Every term is defined before it is used again.</p>

  <p class="define"><span class="define__term">Method</span> A named block of statements you can
  run by name, from anywhere that can see it. Also called a function. Giving a piece of behaviour
  a name is the main way programs stay comprehensible past a few hundred lines.</p>

  <p class="define"><span class="define__term">Parameter</span> A variable declared in the
  method's header, which receives a value when the method is called.</p>

  <p class="define"><span class="define__term">Argument</span> The actual value passed at the
  call site. Parameters are in the declaration; arguments are at the call. The distinction
  matters when reading compiler errors, which use the words precisely.</p>

  <p class="define"><span class="define__term">Return type</span> The type of the value the
  method hands back. <strong>void</strong> means it hands back nothing.</p>

  <p class="define"><span class="define__term">Signature</span> A method's name plus the number,
  types, and modifiers of its parameters. <strong>The return type is not part of it</strong> — a
  fact with immediate consequences, covered below.</p>

  <div class="callout callout--note">
    <h4>The analogy, and where it breaks</h4>
    <p>A method is like a <strong>form you fill in and hand over a counter</strong>. The form's
    boxes are the parameters; what you write in them are the arguments. You get something back
    through the hatch, or you do not.</p>
    <p>Where the analogy breaks, and it is the whole subject of this module: a clerk reads the
    form when you hand it over. A compiled method call has already had part of the form
    <em>printed onto your copy</em> at compile time. If the office later changes the form's
    pre-printed defaults, your copy keeps the old ones until you get a new copy. That is not a
    quirk — it is exactly the first incident above, and the section on optional parameters
    demonstrates it running.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest useful example</h2>

<pre data-lang="csharp" data-net="10" data-title="01-methods-basics.cs"><code>// 100m and 20 are ARGUMENTS. amount and vatPercent are PARAMETERS.
decimal withVat = AddVat(100m, 20);
Console.WriteLine($"AddVat(100m, 20)        = {withVat}");

Announce("batch started");

Console.WriteLine($"Double(21)              = {Double(21)}");

static decimal AddVat(decimal amount, int vatPercent)
{
    return amount + (amount * vatPercent / 100m);
}

static void Announce(string message)
{
    Console.WriteLine($"[ledger] {message}");
}

// Expression-bodied form, for a method that is a single expression.
static int Double(int value) =&gt; value * 2;</code></pre>

<pre data-lang="console" data-title="Output"><code>AddVat(100m, 20)        = 120
[ledger] batch started
Double(21)              = 42</code></pre>

  <p class="define"><span class="define__term">Expression-bodied member</span> The
  <code>=&gt;</code> form, used when a method's whole body is one expression. It means exactly
  the same thing as a braced body containing a single <code>return</code>.</p>

  <p class="define"><span class="define__term">Local function</span> A method declared inside
  another method. It can read the enclosing method's variables, which a normal method cannot.</p>

<pre data-lang="csharp" data-net="10" data-title="01-methods-basics.cs"><code>decimal runningTotal = 0m;
void AddToTotal(decimal amount) =&gt; runningTotal += amount;

AddToTotal(10m);
AddToTotal(32m);
Console.WriteLine($"runningTotal            = {runningTotal}");</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: local functions cannot be overloaded</h4>
    <p>Declaring two local functions with the same name is an error even when their parameter
    types differ:</p>
<pre data-lang="console" data-title="Compiler output"><code>error CS0128: A local variable or function named 'Describe' is already defined in this scope</code></pre>
    <p>This catches people writing in top-level statements, because a <code>static</code> method
    written at the top level of a file <em>is</em> a local function. If you want overloads, they
    have to live in a class. That is why the overload examples later in this module are written
    inside <code>public static class Api</code> rather than as loose methods.</p>
  </div>
</section>

<section id="the-call-stack">
  <h2>What a call costs: the stack</h2>

  <p class="define"><span class="define__term">Call stack</span> The record of which methods are
  currently running. Calling a method pushes an entry on top; returning pops it off. It is the
  same stack of plates whether the program is one method deep or a thousand.</p>

  <p class="define"><span class="define__term">Stack frame</span> One entry on that stack, holding
  the method's parameters, its local variables, and where to return to. Frames are created and
  destroyed automatically, which is why locals vanish when a method returns.</p>

  <p>The stack is fast — pushing a frame is arithmetic on a pointer — but it is
  <strong>fixed in size</strong>, typically about 1 MB per thread by default on Windows. Nothing
  grows it on demand.</p>

  <p class="define"><span class="define__term">Recursion</span> A method calling itself.</p>

  <p class="define"><span class="define__term">Base case</span> The condition under which a
  recursive method stops calling itself and returns. A recursive method without one never
  terminates.</p>

<pre data-lang="csharp" data-net="10" data-title="01-methods-basics.cs"><code>static long Factorial(int n)
{
    if (n &lt;= 1)
    {
        return 1;        // the base case: without it this never terminates
    }
    return n * Factorial(n - 1);
}</code></pre>

  <p class="define"><span class="define__term">Stack overflow</span> What happens when the call
  stack runs out of room. In .NET this raises <code>StackOverflowException</code>, which
  <strong>cannot be caught</strong> — the process is terminated immediately.</p>

  <p>That last sentence deserves proof, because it is the second incident from the opening and it
  is unlike every other exception you will meet.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="06-recursion-depth.cs — this kills the process"><code>try
{
    Recurse(1);
}
catch (Exception ex)
{
    // This never runs for a stack overflow. It is here to prove that.
    Console.WriteLine($"caught {ex.GetType().Name} - if you see this, it was not a stack overflow");
}

Console.WriteLine("this line is never reached");

static void Recurse(int depth)
{
    if (depth % 4_000 == 0)
    {
        Console.WriteLine($"  depth {depth:N0}");
        Console.Out.Flush();
    }

    Recurse(depth + 1);
}</code></pre>

<pre data-lang="console" data-title="dotnet run -c Release 06-recursion-depth.cs"><code>now recursing without a base case:
  depth 4,000
  depth 8,000
  depth 12,000
Stack overflow.
Repeated 13765 times:
--------------------------------
   at Program.&lt;&lt;Main&gt;$&gt;g__Recurse|0_0(Int32)
--------------------------------
   at Program.&lt;Main&gt;$(System.String[])</code></pre>

  <p>Three things to take from that output.</p>

  <ul>
    <li><strong>About 13,700 frames fitted</strong> for this very small method. A method with
    more locals or larger parameters uses more stack per frame and gets nowhere near that. There
    is no fixed "safe recursion depth" — it depends on the frame size.</li>
    <li><strong>The <code>catch</code> block did not run,</strong> and neither did the line after
    it. The runtime prints its own message and terminates the process. No exception handler, no
    <code>finally</code>, and no logging framework gets a chance.</li>
    <li><strong>The runtime tells you the repeat count</strong> — 13,765 identical frames. When
    you see that in a crash dump, it is a recursion bug and the repeated frame names the
    method.</li>
  </ul>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Because it cannot be caught, a stack overflow is the one failure that will not appear in
    your error tracking. A service that "restarts for no reason" with nothing in the logs is a
    prime suspect. The usual causes are recursion over data whose depth you did not control (a
    deeply nested JSON document, a category tree with a cycle in it) and a property that
    accidentally calls itself.</p>
    <p>The defence is to bound the depth explicitly, or to rewrite the recursion as a loop with
    an explicit stack, which grows on the heap and fails with a normal, catchable exception.</p>
  </div>
</section>

<section id="passing-arguments">
  <h2>The four ways to pass an argument</h2>

  <p>By default, an argument is <strong>copied</strong> into the parameter. Three keywords change
  that.</p>

  <p class="define"><span class="define__term">ref</span> Do not copy — let the method work
  directly on the caller's variable. The caller must have assigned it first.</p>

  <p class="define"><span class="define__term">out</span> Also no copy, but the method
  <em>must</em> assign it before returning, and the caller need not have set it beforehand. Used
  to return a second value.</p>

  <p class="define"><span class="define__term">in</span> No copy, but the method may not assign
  it. Used to pass something large without copying it, while promising not to change it.</p>

<pre data-lang="csharp" data-net="10" data-title="02-ref-out-in.cs"><code>int a = 10;
PassByValue(a);
Console.WriteLine($"  after PassByValue(a)   : a = {a}");

int b = 10;
PassByRef(ref b);
Console.WriteLine($"  after PassByRef(ref b) : b = {b}");

PassByOut(out int c);
Console.WriteLine($"  after PassByOut(out c) : c = {c}");

int d = 10;
PassByIn(in d);
Console.WriteLine($"  after PassByIn(in d)   : d = {d}");

static void PassByValue(int value) =&gt; value = 99;
static void PassByRef(ref int value) =&gt; value = 99;
static void PassByOut(out int value) =&gt; value = 99;
static void PassByIn(in int value) =&gt; Console.WriteLine($"  in parameter saw   : {value}");</code></pre>

<pre data-lang="console" data-title="Output"><code>  after PassByValue(a)   : a = 10   &lt;-- unchanged
  after PassByRef(ref b) : b = 99
  after PassByOut(out c) : c = 99
  in parameter saw   : 10
  after PassByIn(in d)   : d = 10   &lt;-- unchanged, by contract</code></pre>

  <p>The keyword is required <strong>at the call site as well as the declaration</strong>, which
  is deliberate: a reader of the calling code can see that the variable may be modified without
  looking up the method.</p>

<pre data-lang="console" data-title="Leaving it off is an error"><code>error CS1620: Argument 1 must be passed with the 'ref' keyword
error CS1620: Argument 2 must be passed with the 'out' keyword</code></pre>

  <p><code>out</code>'s everyday use is a method that must report both success and a value —
  the pattern the framework uses throughout:</p>

<pre data-lang="csharp" data-net="10" data-title="02-ref-out-in.cs"><code>foreach (string candidate in new[] { "42", "not a number" })
{
    if (int.TryParse(candidate, out int parsed))
    {
        Console.WriteLine($"  '{candidate}' parsed to {parsed}");
    }
    else
    {
        Console.WriteLine($"  '{candidate}' rejected (parsed is {parsed}, the default)");
    }
}</code></pre>

<pre data-lang="console" data-title="Output"><code>  '42' parsed to 42
  'not a number' rejected (parsed is 0, the default)</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: <code>ref</code> on a reference type is a second, separate level</h4>
    <p>A variable of a class type holds a <em>reference</em> — a direction to an object rather
    than the object itself. So there are two different things you might want to change: the
    object, or which object the caller's variable points at.</p>
<pre data-lang="csharp" data-net="10" data-title="02-ref-out-in.cs"><code>Basket basket = new Basket("original");

MutateBasket(basket);           // changes the object
ReplaceBasket(basket);          // changes only this method's own copy of the reference
ReplaceBasketByRef(ref basket); // changes which object the CALLER points at

static void MutateBasket(Basket basket) =&gt; basket.Name = "mutated";
static void ReplaceBasket(Basket basket) =&gt; basket = new Basket("replaced");
static void ReplaceBasketByRef(ref Basket basket) =&gt; basket = new Basket("replaced by ref");</code></pre>
<pre data-lang="console" data-title="Output"><code>  after MutateBasket(basket)      : mutated
  after ReplaceBasket(basket)     : mutated   &lt;-- caller unaffected
  after ReplaceBasketByRef(ref b) : replaced by ref</code></pre>
    <p>Without <code>ref</code>, a method can change the object but cannot repoint the caller's
    variable. This is covered from the memory side in
    <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a>; the point here is
    that <code>ref</code> and "reference type" are independent ideas that happen to share a
    word.</p>
  </div>

  <div class="callout callout--note">
    <h4>When to reach for each</h4>
    <p><strong><code>out</code></strong> for a second return value, and only when a
    <code>bool</code>-plus-value pair is genuinely the right shape. Returning a tuple or a
    nullable is usually clearer for anything more complicated.</p>
    <p><strong><code>ref</code></strong> rarely. A method that modifies its caller's variables is
    hard to reason about; returning a new value is almost always better. Its real home is
    performance-critical code operating on large value types in place.</p>
    <p><strong><code>in</code></strong> only on a <code>readonly struct</code>, and only when it
    is large. On a non-readonly struct the compiler inserts a defensive copy at every member
    access, which can make it slower than passing by value — the mechanism is explained in
    <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a>.</p>
  </div>
</section>

<section id="overloads">
  <h2>Overloads: one name, several signatures</h2>

  <p class="define"><span class="define__term">Overload</span> One of several methods sharing a
  name but differing in parameters. <code>Console.WriteLine</code> has nineteen.</p>

  <p class="define"><span class="define__term">Overload resolution</span> The compiler's process
  of deciding which overload a particular call means. It happens entirely at compile time and
  picks the <em>most specific</em> applicable match.</p>

<pre data-lang="csharp" data-net="10" data-title="03-overloads.cs"><code>public static class Api
{
    public static string Describe(int value) =&gt; "int";
    public static string Describe(long value) =&gt; "long";
    public static string Describe(double value) =&gt; "double";
    public static string Describe(decimal value) =&gt; "decimal";

    public static string Log(string? message) =&gt; "string overload";
    public static string Log(object? message) =&gt; "object overload";
}</code></pre>

<pre data-lang="console" data-title="Output"><code>  Describe(5)        -&gt; int
  Describe(5L)       -&gt; long
  Describe(5.0)      -&gt; double
  Describe(5.0m)     -&gt; decimal
  Describe('a')      -&gt; int      &lt;-- char widens to int
  Describe((byte)5)  -&gt; int      &lt;-- byte widens to int
  Describe((short)5) -&gt; int      &lt;-- short widens to int
  Describe(5.0f)     -&gt; double   &lt;-- float widens to double

  Log("text")        -&gt; string overload
  Log(new object())  -&gt; object overload
  Log(null)          -&gt; string overload   &lt;-- string, not object
  Log((object?)null) -&gt; object overload   &lt;-- the cast picks the other one</code></pre>

  <p>Two results there are worth pausing on.</p>

  <p><strong><code>Describe('a')</code> calls the <code>int</code> overload.</strong> There is no
  <code>char</code> overload, so the compiler looks for a conversion that loses nothing — and
  <code>char</code> widens to <code>int</code> silently. If you wrote these four overloads
  expecting a <code>char</code> to be rejected, it will not be; it will quietly be treated as the
  number 97.</p>

  <p><strong><code>Log(null)</code> calls the <code>string</code> overload.</strong>
  <code>null</code> is convertible to both, so the compiler picks the more <em>derived</em> type,
  and <code>string</code> is more derived than <code>object</code>. This is deterministic, but it
  is not what most people guess, and it changes if someone later adds a third overload taking a
  more specific type.</p>

  <p>The return type is not part of the signature, so two methods cannot differ only by it:</p>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>public static int Ambiguous() =&gt; 1;
public static string Ambiguous() =&gt; "1";</code></pre>

<pre data-lang="console" data-title="Compiler output"><code>error CS0111: Type 'Api' already defines a member called 'Ambiguous' with the same parameter types</code></pre>

  <div class="callout callout--warn">
    <h4>Warning: adding an overload is a breaking change in disguise</h4>
    <p>Adding a method looks additive and safe. It is not. Because resolution happens at compile
    time and picks the most specific match, a new overload can capture calls that previously went
    somewhere else — and the caller's source does not change, so nothing draws attention to
    it.</p>
    <p>A library with <code>Log(object)</code> that adds <code>Log(string)</code> silently
    redirects every existing <code>Log("text")</code> call the next time that caller is
    recompiled. If the two overloads behave identically, no harm. If the new one formats
    differently, or handles <code>null</code> differently, the behaviour changes with no code
    change and no warning.</p>
    <p>The habit worth forming: when adding an overload to a widely used method, ask which
    existing call sites will move to it, and make sure the new one is behaviourally compatible
    for those calls.</p>
  </div>
</section>

<section id="optional-and-named">
  <h2>Optional parameters and named arguments</h2>

  <p class="define"><span class="define__term">Optional parameter</span> A parameter with a
  default value, which callers may omit. Optional parameters must come after all required
  ones.</p>

  <p class="define"><span class="define__term">Named argument</span> An argument supplied as
  <code>name: value</code> rather than by position, which allows skipping middle parameters or
  reordering entirely.</p>

<pre data-lang="csharp" data-net="10" data-title="04-optional-and-named.cs"><code>public static class Gateway
{
    public static string Charge(decimal amount, string currency = "GBP", bool capture = false) =&gt;
        $"{amount} {currency}, capture={capture}";
}</code></pre>

<pre data-lang="console" data-title="Output"><code>  Charge(100m)                          -&gt; 100 GBP, capture=False
  Charge(100m, "USD")                   -&gt; 100 USD, capture=False
  Charge(100m, "USD", true)             -&gt; 100 USD, capture=True
  Charge(100m, capture: true)           -&gt; 100 GBP, capture=True
  Charge(currency: "EUR", amount: 100m) -&gt; 100 EUR, capture=False</code></pre>

  <p>Named arguments earn their keep at call sites that are otherwise unreadable. Compare:</p>

<pre data-lang="csharp" data-net="10" data-title="04-optional-and-named.cs"><code>Ledger.Transfer(100m, "A", "B", true, false);

Ledger.Transfer(
    amount: 100m,
    fromAccount: "A",
    toAccount: "B",
    notify: true,
    reverseOnFailure: false);</code></pre>

  <p>Both produce identical results. Only one of them can be reviewed without opening another
  file, and only one of them makes a swapped pair of booleans visible.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha: named arguments do not change evaluation order</h4>
<pre data-lang="csharp" data-net="10" data-title="04-optional-and-named.cs"><code>int counter = 0;
string result = Ledger.Trace(second: Next(ref counter), first: Next(ref counter));</code></pre>
<pre data-lang="console" data-title="Output"><code>  Trace(second: Next(), first: Next())  -&gt; first=1, second=0</code></pre>
    <p>Arguments are evaluated <strong>left to right in the order written</strong>, then bound to
    parameters by name. So the call written first got the value 0 even though it binds to the
    parameter called <code>second</code>. This only bites when arguments have side effects,
    which is a good reason for them not to.</p>
  </div>

  <h3>The trap: a default is copied into the caller</h3>

  <p>This is the first incident from the opening, and it is the single most important thing in
  this module.</p>

  <p>When you write <code>Charge(100m)</code> against a method whose second parameter defaults to
  2, <strong>the compiler rewrites your call to <code>Charge(100m, 2)</code></strong>. The value
  2 is baked into your assembly. The library is never asked at run time.</p>

  <p>Here it is, running. A library with a 2% default fee, and a billing app that omits the
  argument:</p>

<pre data-lang="csharp" data-net="10" data-title="LedgerFees/Fees.cs — version 1"><code>namespace LedgerFees;

public static class Fees
{
    // The default fee is 2%. Version 2 of this library changes it to 5%.
    public static decimal ApplyFee(decimal amount, int feePercent = 2)
    {
        return amount + (amount * feePercent / 100m);
    }

    public static int CurrentDefaultPercent() =&gt; 2;
}</code></pre>

<pre data-lang="csharp" data-net="10" data-title="Billing/Program.cs — never changes"><code>using LedgerFees;

// The caller does NOT pass feePercent. It relies on the library's default.
decimal charged = Fees.ApplyFee(100m);

Console.WriteLine($"library says its default is : {Fees.CurrentDefaultPercent()}%");
Console.WriteLine($"ApplyFee(100m) returned     : {charged}");</code></pre>

  <p>Build both, run, then change <em>only the library</em> to 5%, rebuild <em>only the
  library</em>, and drop the new DLL next to the untouched application:</p>

<pre data-lang="bash" data-title="optional-default-demo/run-demo.sh"><code>dotnet build Billing/Billing.csproj -c Release -o app
./app/Billing.exe

sed -i 's/int feePercent = 2/int feePercent = 5/' LedgerFees/Fees.cs

dotnet build LedgerFees/LedgerFees.csproj -c Release -o libout
cp libout/LedgerFees.dll app/LedgerFees.dll
./app/Billing.exe</code></pre>

<pre data-lang="console" data-title="Output"><code>1. Build everything with the library default at 2%, then run.
library says its default is : 2%
ApplyFee(100m) returned     : 102

4. Run the UNCHANGED app against the NEW library:
library says its default is : 5%
ApplyFee(100m) returned     : 102
   ^ the library reports 5%, but the fee charged is still 2%.

5. Rebuild the consumer (no source change) and run again:
library says its default is : 5%
ApplyFee(100m) returned     : 105
   ^ only now does the new default take effect.</code></pre>

  <p>The library truthfully reports that its default is 5%. The fee charged is 2%. Both
  statements are correct, and the two services that "kept charging 2%" were the two that
  had not been recompiled since the change.</p>

  <p class="define"><span class="define__term">Binary compatibility</span> Whether an already-
  compiled caller keeps working, and keeps behaving the same, against a new version of a library
  it was not rebuilt against.</p>

  <div class="callout callout--warn">
    <h4>Warning: what this makes a breaking change</h4>
    <p>Three things about a method's parameters are baked into callers or become part of your
    public contract:</p>
    <ul>
      <li><strong>Changing a default value</strong> does not take effect until every caller is
      recompiled — and until then, different services run different values while all claiming
      the same library version.</li>
      <li><strong>Renaming a parameter</strong> breaks any caller using it as a named argument.
      The rename compiles cleanly in your library and fails in someone else's build with
      <code>CS1739: The best overload for 'Charge' does not have a parameter named 'rate'</code>.
      <strong>Parameter names are public API.</strong></li>
      <li><strong>Adding a parameter with a default</strong> is source-compatible but not binary
      compatible: existing compiled callers keep calling the old method signature, which no
      longer exists, and fail with <code>MissingMethodException</code> at run time.</li>
    </ul>
    <p>For a library consumed by code you do not rebuild, prefer <strong>overloads over optional
    parameters</strong>. An added overload is a genuinely new method, so old compiled callers
    keep resolving to the old one and keep working.</p>
  </div>
</section>

<section id="params">
  <h2><code>params</code>: any number of arguments</h2>

  <p class="define"><span class="define__term">params</span> A modifier on the last parameter
  allowing callers to pass any number of arguments, which the compiler gathers into a
  collection.</p>

  <p>The convenience has a cost that is invisible at the call site: <strong>every call builds an
  array</strong>. Measured over a million calls:</p>

<pre data-lang="csharp" data-net="10" data-title="05-params-allocation.cs"><code>static long SumParams(params int[] values)
{
    long total = 0;
    foreach (int value in values) { total += value; }
    return total;
}

// C# 13 (.NET 9+) allows params on a span, which the compiler can satisfy from
// the stack instead of the heap.
static long SumSpan(params ReadOnlySpan&lt;int&gt; values)
{
    long total = 0;
    foreach (int value in values) { total += value; }
    return total;
}

static long SumThree(int a, int b, int c) =&gt; a + b + c;

static string Describe(params object[] parts) =&gt; parts.Length.ToString(CultureInfo.InvariantCulture);</code></pre>

<pre data-lang="console" data-title="dotnet run -c Release 05-params-allocation.cs"><code>1,000,000 calls of each shape:

  params int[]              38.8 MB total    40.7 bytes/call
  params ReadOnlySpan        0.0 MB total     0.0 bytes/call
  three fixed args           0.0 MB total     0.0 bytes/call

the same shape with boxing, which is what structured logging does:
  params object[]           91.6 MB total    96.0 bytes/call

an empty params call still allocates nothing in modern .NET:
  params int[], zero         0.0 MB total     0.0 bytes/call</code></pre>

  <p>Read those four numbers carefully, because each says something different.</p>

  <ul>
    <li><strong>40.7 bytes per call</strong> for three <code>int</code>s: a 12-byte payload plus
    the array's own header. Nearly 39 MB of garbage per million calls.</li>
    <li><strong>96 bytes per call</strong> for <code>params object[]</code> with a string, an
    int, and a double — the array <em>plus</em> a heap allocation for each value type put into
    it. This is exactly the shape of a structured logging call, which is why logging in a hot
    loop is expensive even when the log level filters the message out.</li>
    <li><strong>Zero</strong> for <code>params ReadOnlySpan&lt;T&gt;</code>, added in C# 13, which
    the compiler can satisfy from the stack. If you are writing a <code>params</code> API today
    and callers pass values inline, this is the better choice.</li>
    <li><strong>Zero for the empty call.</strong> Modern .NET uses a shared empty array, so
    <code>SumParams()</code> with no arguments costs nothing. The old advice to add a
    no-argument overload purely to avoid that allocation is obsolete.</li>
  </ul>

  <div class="callout callout--note">
    <h4>Version note</h4>
    <p><code>params ReadOnlySpan&lt;T&gt;</code> requires C# 13, which means .NET 9 or later. On
    .NET 8 the options are a plain array, an overload taking a fixed number of arguments for the
    common cases, or accepting the allocation. The <code>params int[]</code> and
    <code>params object[]</code> figures above are unchanged across .NET 8, 9, and 10.</p>
  </div>
</section>

<section id="production-example">
  <h2>The same ideas in a real service</h2>

  <p>Here is a Ledger fee calculator with the parameter decisions made deliberately.</p>

<pre data-lang="csharp" data-net="10" data-title="Ledger — FeeCalculator.cs"><code>using System.Globalization;

public sealed class FeeCalculator
{
    private readonly IFeeScheduleSource _schedule;

    public FeeCalculator(IFeeScheduleSource schedule)
    {
        _schedule = schedule;
    }

    // Overloads rather than optional parameters: this type ships in a package
    // that other teams compile against and do not rebuild on our schedule.
    public Money CalculateFee(Money amount) =&gt;
        CalculateFee(amount, _schedule.CurrentRate(), roundUp: false);

    public Money CalculateFee(Money amount, decimal rate) =&gt;
        CalculateFee(amount, rate, roundUp: false);

    public Money CalculateFee(Money amount, decimal rate, bool roundUp)
    {
        // Guard clauses first: reject the impossible before doing any work.
        if (amount.Amount &lt; 0m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(amount), amount.Amount, "Fee cannot be calculated on a negative amount.");
        }

        if (rate &lt; 0m || rate &gt; 1m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(rate), rate, "Rate must be between 0 and 1.");
        }

        decimal raw = amount.Amount * rate;

        decimal rounded = roundUp
            ? Math.Ceiling(raw * 100m) / 100m
            : Math.Round(raw, 2, MidpointRounding.AwayFromZero);

        return new Money(rounded, amount.Currency);
    }

    // The TryParse shape: a bool result plus an out value, for input that may
    // legitimately be invalid rather than being a bug.
    public bool TryCalculateFee(Money amount, decimal rate, out Money fee)
    {
        if (amount.Amount &lt; 0m || rate &lt; 0m || rate &gt; 1m)
        {
            fee = new Money(0m, amount.Currency);
            return false;
        }

        fee = CalculateFee(amount, rate, roundUp: false);
        return true;
    }
}

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() =&gt;
        Amount.ToString("0.00", CultureInfo.InvariantCulture) + " " + Currency;
}

public interface IFeeScheduleSource
{
    decimal CurrentRate();
}</code></pre>

  <p>Four parameter decisions in that code, each of which the rest of this module explains:</p>

  <ul>
    <li><strong>Overloads instead of optional parameters,</strong> because this type ships to
    other teams. The default rate is fetched at run time from
    <code>_schedule.CurrentRate()</code> rather than being a compile-time default, so changing it
    does not require anyone to rebuild.</li>
    <li><strong><code>roundUp:</code> named at the call site</strong> even internally, because a
    bare <code>true</code> as the third argument tells a reviewer nothing.</li>
    <li><strong><code>nameof(amount)</code> in the exception,</strong> so the parameter name in
    the error stays correct if the parameter is renamed.</li>
    <li><strong><code>TryCalculateFee</code> uses <code>out</code></strong> for the case where
    invalid input is expected, while <code>CalculateFee</code> throws for the case where it means
    a bug. Both shapes exist deliberately rather than one being a fallback for the other.</li>
  </ul>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A changed default that only some services pick up</h3>

  <p>Demonstrated above. The symptom is the giveaway: services on the <em>same library version</em>
  behaving differently, with the difference tracking which of them was rebuilt most recently.
  There is no configuration to check and nothing in the logs.</p>

  <h3>2. A renamed parameter breaking someone else's build</h3>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="A rename that looks harmless"><code>// Before
public static decimal Charge(decimal amount, int feePercent) =&gt; amount;

// After: "feePercent" renamed to "rate" for clarity
public static decimal Charge(decimal amount, int rate) =&gt; amount;</code></pre>

<pre data-lang="console" data-title="What a consumer using named arguments sees"><code>error CS1739: The best overload for 'Charge' does not have a parameter named 'rate'</code></pre>

  <p>Your library compiles. Their build fails. Parameter names are part of your public API the
  moment anyone uses a named argument, and you cannot tell from your own codebase whether anyone
  does.</p>

  <h3>3. Unbounded recursion killing the process</h3>

  <p>Shown above: uncatchable, no log entry, process gone. The most common real-world sources are
  recursion over externally supplied data — a nested document, a hierarchy with a cycle — and
  the self-calling property, which is easy to write by accident:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="A property that calls itself"><code>public decimal Total
{
    get =&gt; Total;        // meant to be _total; this recurses until the process dies
}</code></pre>

  <h3>4. <code>params</code> in a hot path</h3>

  <p>Measured above at 40.7 bytes per call for three integers and 96 bytes for
  <code>params object[]</code>. The cost is invisible at the call site — a
  <code>params</code> call looks identical to a fixed-argument call — which is why it survives
  code review.</p>

  <h3>5. An overload chosen that you did not intend</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>Log(null);              // calls Log(string), not Log(object)
Describe('a');          // calls Describe(int); the char became 97</code></pre>

  <p>Both compile without warning and do something defensible but unintended. When behaviour
  differs between two overloads, a cast at the call site — <code>Log((object?)null)</code> — is
  how you say which one you meant.</p>

  <h3>6. Ignoring an <code>out</code> result</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>int.TryParse(input, out int quantity);   // return value discarded
Ship(quantity);                          // ships 0 items on bad input</code></pre>

  <p>The compiler does not warn, because discarding a return value is legal. On failure
  <code>TryParse</code> sets the output to <strong>zero</strong>, which for a quantity or a price
  is a plausible-looking wrong answer rather than an obvious one.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>Symptom: two deployments of the same version behave differently</h4>
    <ol>
      <li><strong>Check what the callers were compiled against,</strong> not what they are
      running against. The two are different questions, and this failure lives in the gap.</li>
      <li><strong>Ask the library at run time what it thinks the value is,</strong> and compare
      with the behaviour. A library reporting 5% while behaving as 2% is conclusive — it means a
      compile-time constant was copied into the caller.</li>
      <li><strong>Confirm from the caller's IL.</strong> Decompile the calling assembly and look
      at the call site. An optional parameter shows up as a literal argument that is not in the
      source:
<pre data-lang="console" data-title="What the decompiled caller looks like"><code>// source says:   Fees.ApplyFee(100m)
// IL calls:      Fees.ApplyFee(100m, 2)</code></pre>
      </li>
      <li><strong>Fix by rebuilding every consumer</strong> as an immediate action, then remove
      the cause: turn the default into a run-time lookup, or replace the optional parameter with
      overloads so old callers keep resolving to a real method.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: the process disappears with no exception and no log</h4>
    <ol>
      <li><strong>Suspect a stack overflow first.</strong> It is the main failure that bypasses
      every handler, including <code>AppDomain.UnhandledException</code>. The other candidates
      are the process being killed externally (out-of-memory killer, container limit) and a
      hard <code>Environment.FailFast</code>.</li>
      <li><strong>Look at standard error, not your log file.</strong> The runtime writes its own
      message there and it never reaches a logging framework:
<pre data-lang="console"><code>Stack overflow.
Repeated 13765 times:
--------------------------------
   at Program.&lt;&lt;Main&gt;$&gt;g__Recurse|0_0(Int32)</code></pre>
      The repeated frame names the offending method directly.</li>
      <li><strong>In a container, capture stderr</strong> — <code>kubectl logs --previous</code>
      for the crashed instance. If stdout is all you collect, this message is lost and the crash
      looks causeless.</li>
      <li><strong>Fix by bounding the depth</strong> — pass a depth counter and throw a normal
      exception past a limit — or convert the recursion to a loop with an explicit
      <code>Stack&lt;T&gt;</code>, which grows on the heap and fails catchably.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: high allocation rate with no obvious <code>new</code></h4>
    <ol>
      <li><strong>Measure per-call allocation</strong> rather than guessing:
<pre data-lang="csharp" data-net="10"><code>long before = GC.GetAllocatedBytesForCurrentThread();
DoTheWork();
long after = GC.GetAllocatedBytesForCurrentThread();
Console.WriteLine($"{after - before} bytes");</code></pre>
      </li>
      <li><strong>Look for arrays you did not write.</strong> A heap snapshot
      (<code>dotnet-gcdump collect --process-id 1234</code>) showing large counts of
      <code>System.Object[]</code> or <code>System.Int32[]</code> points at <code>params</code>
      calls, most often logging.</li>
      <li><strong>Check whether the log level even admits the message.</strong> The array is
      built before the call, so a filtered-out <code>LogDebug</code> still allocates. The
      <code>LoggerMessage</code> source generator exists for exactly this.</li>
      <li><strong>Fix</strong> with fixed-arity overloads for the common cases, or
      <code>params ReadOnlySpan&lt;T&gt;</code> on .NET 9 or later.</li>
    </ol>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's shared <code>LedgerFees</code> package is referenced by eleven services. The
    platform team changed the default fee from 2% to 5%, published version 4.2.0, and every
    service picked it up within a fortnight through normal dependency updates.</p>
    <p>Nine services began charging 5%. Two did not. Those two had taken the package update as a
    transitive dependency without being rebuilt — their deployment pipelines only rebuild on a
    source change, and neither had had one.</p>
    <p>The measured behaviour, reproduced exactly by the demo in this module:</p>
<pre data-lang="console"><code>library says its default is : 5%
ApplyFee(100m) returned     : 102     &lt;-- 2%, from a library that says 5%</code></pre>
    <p>The cost. Those two services processed roughly <strong>18,000 transactions a day</strong>
    at an average of £42. The 3-point gap is about <strong>£1.26 per transaction</strong>, so
    roughly <strong>£22,700 a day</strong> of fees not collected, for the
    <strong>19 days</strong> before an accountant queried the revenue split — about
    <strong>£430,000</strong>. Recovering it meant re-invoicing customers who had already been
    told what they owed, which cost more in support time and goodwill than the shortfall.</p>
    <p>What makes this worth a section rather than a footnote is that <strong>every diagnostic
    signal pointed the wrong way</strong>. The dependency manifest showed 4.2.0. The library,
    asked at run time, correctly answered 5%. Unit tests passed, because they were compiled
    against the same version they tested. Nothing was misconfigured, and there was nothing in any
    log to find.</p>
    <p>Two changes prevent it, and neither is exotic:</p>
    <ul>
      <li><strong>Do not express a business policy as an optional parameter default.</strong> A
      fee rate is data that changes; it belongs in configuration or a schedule the library reads
      at run time. A compile-time default is for a value that is true by definition.</li>
      <li><strong>For any library other teams compile against, prefer overloads.</strong> An
      overload is a real method, resolved by reference rather than copied by value, so an
      un-rebuilt caller keeps working correctly rather than working incorrectly.</li>
    </ul>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An optional parameter's default is read from the library at run time."</strong></p>
    <p>It is copied into the caller at compile time. Demonstrated above: the library reported 5%
    while the un-rebuilt caller kept charging 2%. This is the same mechanism that makes
    <code>const</code> across assembly boundaries dangerous, covered in
    <a href="#/m/t1-02-variables-and-types">Variables and Types</a>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Adding an overload is always a safe, additive change."</strong></p>
    <p>Overload resolution picks the most specific match at compile time, so a new, more specific
    overload captures existing call sites when they are next recompiled. The caller's source does
    not change, so nothing flags it. Adding <code>Log(string)</code> beside
    <code>Log(object)</code> silently redirects every <code>Log("text")</code> call.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Renaming a parameter is a cosmetic change."</strong></p>
    <p>Parameter names are public API. Any caller using a named argument breaks with
    <code>CS1739</code>, and you cannot see from your own codebase whether anyone does. Rename
    parameters as freely as you like on <code>private</code> methods and treat them as fixed on
    public ones.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>StackOverflowException</code> is an exception like any other, so I can
    catch it."</strong></p>
    <p>Since .NET 2.0 it cannot be caught. The runtime prints a message to standard error and
    terminates the process immediately — no <code>catch</code>, no <code>finally</code>, no
    unhandled-exception handler. Proven above: the <code>catch (Exception)</code> block did not
    run.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>A long parameter list of same-typed values.</strong></p>
    <p><code>Transfer(100m, "A", "B", true, false)</code> is unreviewable, and two swapped
    booleans compile perfectly. Named arguments help at the call site; a parameter object —
    <code>Transfer(TransferRequest request)</code> — fixes it at the declaration and lets the
    compiler catch the swap. Once a method has more than three or four parameters, that is the
    signal.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong><code>ref</code> as a general-purpose way to return more than one value.</strong></p>
    <p>A method that reaches back and modifies its caller's variables is hard to follow and hard
    to test. Return a tuple, a record, or a nullable instead. <code>out</code> is justified for
    the <code>TryX</code> pattern because it is a widely recognised convention;
    <code>ref</code> rarely is, outside performance work on large value types.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Situation</th><th>Use</th><th>Because</th></tr></thead>
      <tbody>
        <tr><td>An internal method, a value that is usually the same</td><td>Optional parameter</td><td>Concise, and recompilation is not a concern within one assembly.</td></tr>
        <tr><td>A library other teams compile against</td><td>Overloads</td><td>Defaults are copied into callers; overloads are resolved to real methods.</td></tr>
        <tr><td>A default that is a business decision</td><td>Configuration or a run-time lookup</td><td>Policy changes; a compile-time constant does not.</td></tr>
        <tr><td>Input that may legitimately be invalid</td><td><code>bool</code> return + <code>out</code></td><td>The <code>TryX</code> convention. No exception on an expected condition.</td></tr>
        <tr><td>Returning two related values</td><td>A tuple or a record</td><td>Clearer than <code>out</code>, and composes with LINQ and pattern matching.</td></tr>
        <tr><td>A large <code>readonly struct</code> in a hot path</td><td><code>in</code></td><td>Avoids copying. Only on <code>readonly</code> structs, or defensive copies make it worse.</td></tr>
        <tr><td>More than three or four parameters</td><td>A parameter object</td><td>The compiler can then catch a swapped pair; named arguments only help the reader.</td></tr>
        <tr><td>Variable argument counts, .NET 9+</td><td><code>params ReadOnlySpan&lt;T&gt;</code></td><td>Zero allocation against 40.7 bytes per call for an array.</td></tr>
        <tr><td>A boolean argument at a call site</td><td>Name it: <code>roundUp: true</code></td><td>A bare <code>true</code> is unreadable and unreviewable.</td></tr>
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
    <p>Given these declarations, say which overload each call selects, and why.</p>
<pre data-lang="csharp" data-net="10"><code>public static class Api
{
    public static string Describe(int value) =&gt; "int";
    public static string Describe(long value) =&gt; "long";
    public static string Describe(double value) =&gt; "double";

    public static string Log(string? message) =&gt; "string";
    public static string Log(object? message) =&gt; "object";
}

// (a) Api.Describe(5)
// (b) Api.Describe('a')
// (c) Api.Describe(5.0f)
// (d) Api.Log(null)
// (e) Api.Log((object?)null)</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <ul>
          <li><strong>(a) <code>int</code>.</strong> An untyped whole-number literal is an
          <code>int</code>, so this is an exact match and exact matches win outright.</li>
          <li><strong>(b) <code>int</code>.</strong> There is no <code>char</code> overload.
          <code>char</code> converts to <code>int</code> without losing information, and
          <code>int</code> is the narrowest type that can accept it. The character becomes the
          number 97.</li>
          <li><strong>(c) <code>double</code>.</strong> There is no <code>float</code> overload;
          <code>float</code> widens to <code>double</code> losslessly. Note that
          <code>float</code> does <em>not</em> convert to <code>long</code> implicitly, so
          <code>double</code> is the only candidate.</li>
          <li><strong>(d) <code>string</code>.</strong> <code>null</code> converts to both, so
          the compiler picks the more derived type, and <code>string</code> derives from
          <code>object</code>.</li>
          <li><strong>(e) <code>object</code>.</strong> The cast gives the argument a static type
          of <code>object</code>, so the <code>string</code> overload is no longer
          applicable.</li>
        </ul>
        <p>The rule underneath all five: overload resolution happens <strong>at compile time,
        using the static type of each argument</strong>, and picks the most specific applicable
        candidate. It never looks at the run-time value — which is why
        <code>Log(null)</code> and <code>Log((object?)null)</code> pass the same value and call
        different methods.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This is a public method in a NuGet package used by six other teams. It contains four
    decisions that will cause problems later. Identify them, say what each one breaks, and
    rewrite the method.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public static class Payments
{
    public static decimal Settle(
        decimal amt,
        string cur = "GBP",
        decimal feeRate = 0.02m,
        bool notify = true,
        params string[] tags)
    {
        decimal fee = amt * feeRate;
        return amt - fee;
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>1. <code>feeRate = 0.02m</code> is a business policy as a compile-time
        default.</strong> Change it and only recompiled consumers get the new rate. Six teams,
        six rebuild schedules, six different fee rates in production, all reporting the same
        package version. This is the incident from this module.</p>

        <p><strong>2. The parameter names <code>amt</code> and <code>cur</code> are abbreviated
        — and permanent.</strong> They are public API the moment a consumer writes
        <code>Settle(amt: 100m)</code>. Renaming them to <code>amount</code> and
        <code>currency</code> later breaks those builds with CS1739. Abbreviated names are worth
        fixing before the first release and effectively unfixable after.</p>

        <p><strong>3. Four optional parameters on a public API.</strong> Beyond the default-baking
        problem, adding a fifth later is not binary compatible: existing compiled callers call a
        signature that no longer exists and fail with <code>MissingMethodException</code> at run
        time rather than at build time.</p>

        <p><strong>4. <code>params string[] tags</code> allocates on every call</strong> — about
        40 bytes even for a couple of tags — and it is unusable in combination with the optional
        parameters. A caller who wants to pass tags must supply every optional argument
        positionally first, so the convenience the defaults were meant to provide is cancelled by
        the <code>params</code>.</p>

        <p>There is also a <strong>correctness bug</strong> worth catching: <code>cur</code> is
        accepted and never used. The method returns a bare <code>decimal</code>, so a caller
        settling in USD gets a number with no currency attached and no error.</p>

        <p>The rewrite:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public sealed record SettlementRequest(
    Money Amount,
    decimal FeeRate,
    bool Notify = true,
    IReadOnlyList&lt;string&gt;? Tags = null);

public static class Payments
{
    // Overloads, not optional parameters: each is a real method that an
    // un-rebuilt caller keeps resolving to correctly.
    public static Money Settle(Money amount, decimal feeRate) =&gt;
        Settle(new SettlementRequest(amount, feeRate));

    public static Money Settle(SettlementRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.FeeRate &lt; 0m || request.FeeRate &gt; 1m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(request), request.FeeRate, "Fee rate must be between 0 and 1.");
        }

        decimal fee = Math.Round(
            request.Amount.Amount * request.FeeRate, 2, MidpointRounding.AwayFromZero);

        return new Money(request.Amount.Amount - fee, request.Amount.Currency);
    }
}</code></pre>
        <p>What changed, and why each matters:</p>
        <ul>
          <li><strong>No default fee rate at all.</strong> The caller supplies it, or gets it from
          a schedule. A rate is data, not a language-level constant.</li>
          <li><strong>A parameter object</strong> means adding a field later is binary compatible
          — old callers keep calling the same two-argument overload.</li>
          <li><strong><code>Money</code> carries the currency,</strong> so it cannot be accepted
          and silently dropped.</li>
          <li><strong>Full parameter names,</strong> fixed now while it is still free.</li>
          <li><strong><code>IReadOnlyList</code> instead of <code>params</code>,</strong>
          nullable so the common case passes nothing and allocates nothing.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A service restarts a few times a day. There is nothing in the application log, the
    unhandled-exception handler never fires, and the last log line differs each time. Describe
    how you would confirm the cause, and how you would fix a recursive method that walks a
    category tree supplied by an external system.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Confirming it.</strong> The combination of "process gone", "handler never
        fired", and "nothing in the log" narrows the field sharply. Only a few things bypass every
        handler:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Candidate</th><th>How to confirm</th></tr></thead>
            <tbody>
              <tr><td>Stack overflow</td><td>Message on <strong>standard error</strong>, with a repeated frame count. Never reaches a logging framework.</td></tr>
              <tr><td>Killed by the OS or container</td><td>Exit code 137, and an OOM entry in the kernel log or pod events.</td></tr>
              <tr><td><code>Environment.FailFast</code></td><td>Writes a Windows event log entry or a crash dump; usually deliberate and greppable in source.</td></tr>
              <tr><td>A native crash in an interop library</td><td>Core dump; no managed stack.</td></tr>
            </tbody>
          </table>
        </div>
        <p>The decisive step is <strong>capturing standard error</strong>, which most deployments
        do not route to their log aggregator. In Kubernetes,
        <code>kubectl logs --previous</code> for the crashed instance shows it:</p>
<pre data-lang="console"><code>Stack overflow.
Repeated 13765 times:
--------------------------------
   at Ledger.Catalogue.CategoryWalker.Walk(Category)</code></pre>
        <p>The repeated frame names the method. That the last application log line differs each
        time is consistent with a data-dependent depth rather than a specific code path.</p>

        <p><strong>Fixing it.</strong> The input comes from an external system, so its depth is
        not something you control, and a cycle in the data makes any depth limit necessary
        anyway. Two options.</p>
        <p>The minimal fix — bound the depth and detect cycles, so a bad tree becomes a handled
        error instead of a dead process:</p>
<pre data-lang="csharp" data-net="10" data-title="Bounded recursion"><code>private const int MaxDepth = 64;

public void Walk(Category category, int depth = 0, HashSet&lt;string&gt;? seen = null)
{
    ArgumentNullException.ThrowIfNull(category);

    if (depth &gt; MaxDepth)
    {
        throw new InvalidOperationException(
            $"Category tree deeper than {MaxDepth} at '{category.Id}'; likely malformed.");
    }

    seen ??= new HashSet&lt;string&gt;(StringComparer.Ordinal);

    if (!seen.Add(category.Id))
    {
        throw new InvalidOperationException($"Cycle detected at category '{category.Id}'.");
    }

    Process(category);

    foreach (Category child in category.Children)
    {
        Walk(child, depth + 1, seen);
    }
}</code></pre>
        <p>The structural fix — no recursion at all. An explicit stack lives on the heap, so
        depth is limited by available memory rather than by the 1 MB thread stack, and running out
        raises a normal, catchable <code>OutOfMemoryException</code>:</p>
<pre data-lang="csharp" data-net="10" data-title="Iterative, with an explicit stack"><code>public void Walk(Category root)
{
    ArgumentNullException.ThrowIfNull(root);

    HashSet&lt;string&gt; seen = new HashSet&lt;string&gt;(StringComparer.Ordinal);
    Stack&lt;Category&gt; pending = new Stack&lt;Category&gt;();
    pending.Push(root);

    while (pending.Count &gt; 0)
    {
        Category category = pending.Pop();

        if (!seen.Add(category.Id))
        {
            throw new InvalidOperationException($"Cycle detected at category '{category.Id}'.");
        }

        Process(category);

        foreach (Category child in category.Children)
        {
            pending.Push(child);
        }
    }
}</code></pre>
        <p><strong>Which to choose.</strong> The bounded version if the tree is genuinely shallow
        and a deep one means corrupt data you want to reject loudly. The iterative version if
        depth is legitimately unbounded. Both add cycle detection, which the original lacked — and
        a cycle is the most likely cause here, since it produces infinite depth from a small
        amount of data.</p>
        <p>Note the traversal order changes in the iterative version: a stack yields the last
        child first. If order matters, reverse the children when pushing, or use a
        <code>Queue&lt;T&gt;</code> for breadth-first.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>You maintain <code>LedgerFees</code>, used by eleven services you do not control the build
    of. You must change the default fee from 2% to 5% so that <strong>every consumer gets the new
    rate without being rebuilt</strong>, while keeping every existing call site compiling
    unchanged.</p>
    <p>Show the change, explain why the obvious approaches fail, and state what you would tell
    the eleven teams.</p>
<pre data-lang="csharp" data-net="10"><code>public static class Fees
{
    public static decimal ApplyFee(decimal amount, int feePercent = 2)
    {
        return amount + (amount * feePercent / 100m);
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why the obvious approaches fail.</strong></p>
        <ul>
          <li><strong>Changing the default to 5.</strong> The default is copied into each caller
          at compile time, so nothing changes until each is rebuilt — demonstrated in this module,
          where the library reported 5% while the caller kept charging 2%. This is precisely the
          failure to avoid.</li>
          <li><strong>Removing the parameter and hard-coding 5%.</strong> Breaks source
          compatibility for every caller passing an explicit percentage, and is not binary
          compatible either: compiled callers reference the two-argument signature and would fail
          with <code>MissingMethodException</code>.</li>
          <li><strong>Adding an overload <code>ApplyFee(decimal)</code>.</strong> Closer, but on
          its own it does not help. Existing callers were compiled against the optional-parameter
          form and their IL already calls <code>ApplyFee(decimal, int)</code> with the literal 2.
          Adding a method does not change what they already call.</li>
        </ul>
        <p><strong>The insight:</strong> the value has to stop being a compile-time constant
        <em>and</em> the already-compiled call has to keep working. That means the existing
        two-argument method must survive, and the default must be resolved inside the library at
        run time. A sentinel value distinguishes "caller did not choose" from "caller chose".</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public static class Fees
{
    /// &lt;summary&gt;
    /// Passed by callers that want the current default rate rather than a
    /// specific one. Kept forever: old assemblies were compiled with a literal
    /// and must continue to resolve to this method.
    /// &lt;/summary&gt;
    public const int UseCurrentDefault = -1;

    private static volatile Func&lt;int&gt; _defaultPercentSource = static () =&gt; 5;

    /// &lt;summary&gt;Set by the host at startup, from configuration.&lt;/summary&gt;
    public static void ConfigureDefaultPercent(Func&lt;int&gt; source)
    {
        ArgumentNullException.ThrowIfNull(source);
        _defaultPercentSource = source;
    }

    public static int CurrentDefaultPercent() =&gt; _defaultPercentSource();

    // The signature is unchanged, so callers compiled against the old version
    // still bind to this exact method.
    public static decimal ApplyFee(decimal amount, int feePercent = UseCurrentDefault)
    {
        // Old assemblies baked in the literal 2. Treat that, and the sentinel,
        // as "no explicit choice was made".
        int effective = feePercent switch
        {
            UseCurrentDefault =&gt; CurrentDefaultPercent(),
            2 =&gt; CurrentDefaultPercent(),   // see the caveat below
            _ =&gt; feePercent
        };

        if (effective &lt; 0 || effective &gt; 100)
        {
            throw new ArgumentOutOfRangeException(
                nameof(feePercent), feePercent, "Fee percent must be between 0 and 100.");
        }

        return amount + (amount * effective / 100m);
    }
}</code></pre>

        <p><strong>The caveat, which is the real lesson.</strong> That
        <code>2 =&gt; CurrentDefaultPercent()</code> line is genuinely dangerous: it cannot
        distinguish an old caller who baked in 2 from a new caller who <em>deliberately</em>
        chose 2%. Both send the same bits. There is no way to tell them apart, because the
        information was destroyed at the old caller's compile time.</p>
        <p>So the honest answer to the exercise is in two parts:</p>
        <ol>
          <li><strong>The mechanism above works</strong> — the sentinel plus a run-time lookup
          means future changes to the rate propagate without rebuilds, and the unchanged signature
          keeps old callers binding correctly.</li>
          <li><strong>The one-off migration cannot be done safely by the library alone.</strong>
          Silently reinterpreting 2 breaks anyone who meant it. The correct action is to ship the
          sentinel version <em>without</em> the <code>2</code> case, and require the eleven teams
          to rebuild once — after which no future rate change ever needs a rebuild again.</li>
        </ol>
        <p><strong>What to tell the eleven teams:</strong> this release requires a rebuild, once,
        and here is the date after which the old behaviour is considered a bug; the fee rate is
        now read from configuration at run time, so this is the last time a rate change requires
        anything from you; and if you were passing 2 explicitly, keep doing so — it will continue
        to mean 2.</p>
        <p>The wider point: an optional parameter default is a value <em>copied into every
        consumer's binary</em>. Once that has happened you cannot fully undo it from the library
        side, because you cannot distinguish a copied default from a deliberate choice. That
        asymmetry is why the decision to use one is worth making carefully the first time.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is the difference between a parameter and an argument?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A parameter is the variable declared in the method's header. An argument is the value
        supplied at the call site. Compiler messages use the words precisely, so the distinction
        is worth keeping.</p>
      </div></details>
    </li>
    <li>
      <p>Is the return type part of a method's signature?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. The signature is the name plus the parameter types and modifiers. Two methods
        differing only by return type are the same method declared twice —
        <code>error CS0111</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Where does an optional parameter's default value live at run time?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>In the <strong>caller</strong>. The compiler rewrites <code>Charge(100m)</code> into
        <code>Charge(100m, 2)</code> and bakes the literal into the calling assembly. Changing the
        default in the library has no effect until every caller is recompiled — measured in this
        module as a library reporting 5% while the caller charged 2%.</p>
      </div></details>
    </li>
    <li>
      <p>Why is renaming a public method's parameter a breaking change?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Because any caller using a named argument refers to it by name. After the rename their
        build fails with <code>CS1739: The best overload ... does not have a parameter named
        'rate'</code>. Parameter names are public API, and you cannot tell from your own codebase
        whether anyone relies on them.</p>
      </div></details>
    </li>
    <li>
      <p>What happens when a program recurses without a base case?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The call stack fills — roughly 13,700 frames for a tiny method, fewer for a larger
        one — and the runtime terminates the <strong>process</strong>.
        <code>StackOverflowException</code> cannot be caught: no <code>catch</code>, no
        <code>finally</code>, no unhandled-exception handler. The message goes to standard error
        with a repeated-frame count naming the method.</p>
      </div></details>
    </li>
    <li>
      <p>What does a <code>params</code> call cost, and how do you avoid it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It allocates an array per call — measured at 40.7 bytes for three <code>int</code>s and
        96 bytes for <code>params object[]</code> with three boxed values. Avoid it with
        fixed-arity overloads, or <code>params ReadOnlySpan&lt;T&gt;</code> on .NET 9+, which
        measured zero. An empty <code>params</code> call already allocates nothing.</p>
      </div></details>
    </li>
    <li>
      <p>Which overload does <code>Log(null)</code> call when both <code>Log(string)</code> and
      <code>Log(object)</code> exist?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Log(string)</code>. <code>null</code> converts to both, so the compiler picks the
        more derived type. Resolution uses the argument's <em>static</em> type at compile time, so
        <code>Log((object?)null)</code> passes the same value and calls the other method.</p>
      </div></details>
    </li>
  </ol>

  <div class="callout callout--note">
    <h4>Where this leads</h4>
    <p><a href="#/m/t1-08-classes-and-objects">Classes and Objects</a> gives methods somewhere to
    live and introduces constructors, which are methods with their own rules.
    <a href="#/m/t1-11-polymorphism">Polymorphism and Virtual Dispatch</a> covers what happens
    when a call has to decide at run time which method to run — the opposite of the compile-time
    resolution here.
    <a href="#/m/t1-30-extension-methods">Extension Methods</a> is a way of adding methods to
    types you do not own, with its own resolution rules, and
    <a href="#/m/t2-19-span-and-memory">Span and Memory</a> explains why
    <code>params ReadOnlySpan&lt;T&gt;</code> can allocate nothing at all.</p>
  </div>
</section>

`
});
