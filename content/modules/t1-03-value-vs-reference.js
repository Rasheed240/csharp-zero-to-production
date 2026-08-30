/* ============================================================================
   Track 1, Module 3 — Value Types vs Reference Types
   Status: frozen. See STYLE-CONTRACT.md §10 before changing anything here.

   Every C# snippet in this module was compiled and run on .NET 10.0.400.
   The runnable sources are in verification/t1-03-value-vs-reference/.
   ========================================================================= */

CSPREP.module({
  id: "t1-03-value-vs-reference",
  minutes: 55,
  updated: "2026-08-29",
  summary:
    "Some values are copied when you assign them and some are shared. Getting this wrong " +
    "produces bugs where an assignment silently does nothing, and performance problems " +
    "where a service allocates gigabytes it did not need to.",
  terms: [
    "memory", "variable", "type", "value type", "reference type", "struct", "class",
    "stack", "heap", "reference", "null", "allocate", "garbage collector", "boxing",
    "unboxing", "defensive copy", "readonly struct", "record struct", "identity",
    "immutable", "ref local", "aliasing"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>You are building an invoicing service. A colleague reports a bug: a customer's invoice
  total is wrong. You look at the code that applies a discount, and it reads exactly as you
  would expect it to read. You add a log line. The discount is calculated correctly. You add
  another log line after the discount is applied. The invoice total has not changed.</p>

  <p>The code did not throw. Nothing was caught and swallowed. There is no <em>if</em>
  statement skipping it. The line ran, it computed the right number, and the number went
  nowhere.</p>

  <p>Now a second report, from the operations team this time: the same service is using
  4&nbsp;GB of memory to process a file that is 200&nbsp;MB on disk, and the server pauses for
  a noticeable fraction of a second every few minutes.</p>

  <p>These two problems look unrelated. They are the same problem. Both come from not knowing
  which of your types get <strong>copied</strong> when you assign them and which get
  <strong>shared</strong>, and where the data for each actually lives.</p>

  <p>This is the single most load-bearing distinction in C#. Almost everything later in this
  curriculum — how collections behave, why <code>async</code> allocates, what the garbage
  collector is cleaning up, why <code>Span</code> exists, how Entity Framework tracks changes —
  is built on top of it. So this module goes slowly, and then goes deep.</p>
</section>

<section id="what-memory-is">
  <h2>First, what memory actually is</h2>

  <p>Nothing here assumes you know any of the following words, so here they all are.</p>

  <p class="define"><span class="define__term">Memory</span> The working space your program uses
  while it is running. Physically it is RAM: a very long row of numbered slots. Each slot holds
  one <strong>byte</strong> (a small number, 0 to 255) and has an <strong>address</strong>,
  which is the slot's position in the row — slot 0, slot 1, slot 5,299,104. When your
  program stops, memory is handed back and everything in it is gone.</p>

  <p>A useful mental picture: memory is a street of numbered lockers. Each locker holds a tiny
  amount of data. Bigger things occupy a run of consecutive lockers.</p>

  <p class="define"><span class="define__term">Variable</span> A name your code uses to refer to
  a particular place in memory. When you write <code>int count = 5;</code> you are saying
  "reserve enough lockers to hold a whole number, put 5 in them, and let me call that place
  <code>count</code>". The name exists only in your source code; the running program works with
  the address.</p>

  <p class="define"><span class="define__term">Type</span> A rule about what a piece of memory
  means and how big it is. <code>int</code> means "four bytes, interpreted as a whole number".
  <code>bool</code> means "one byte, interpreted as true or false". Types are what let the
  compiler catch you subtracting a customer from a date before your users find out.</p>

  <p class="define"><span class="define__term">Allocate</span> To reserve a region of memory for
  something. "This object allocates 24 bytes" means creating it reserves 24 bytes.</p>

  <p class="define"><span class="define__term">Instance</span> One particular thing of a given
  type. <code>Invoice</code> is a type; the specific invoice INV-1001 sitting in memory right
  now is an instance of it. "Object" is used loosely as a synonym.</p>

  <p>With that vocabulary in place, the actual subject.</p>
</section>

<section id="two-families">
  <h2>C# has exactly two families of type</h2>

  <p>Every type in C# is one of two kinds, and the kind decides what happens when you assign
  it, pass it to a method, or put it in a list.</p>

  <p class="define"><span class="define__term">Value type</span> A type whose variable holds the
  data itself. Assigning it copies the data. Declared with the keyword <code>struct</code> (or
  <code>enum</code>). <code>int</code>, <code>bool</code>, <code>double</code>,
  <code>char</code>, <code>DateTime</code>, <code>Guid</code>, and
  <code>decimal</code> are all value types.</p>

  <p class="define"><span class="define__term">Reference type</span> A type whose variable holds
  a <em>direction to</em> the data rather than the data. Assigning it copies the direction, so
  both variables end up pointing at one shared thing. Declared with the keyword
  <code>class</code> (also <code>interface</code>, <code>delegate</code>, and arrays).
  <code>string</code>, <code>List</code>, and every class you write are reference types.</p>

  <p class="define"><span class="define__term">Reference</span> The "direction to the data". In
  practice it is a memory address, but you never see or manipulate the number in normal C#. You
  can think of it as a locker key: small, easy to copy, and a copy of the key opens the same
  locker.</p>

  <div class="callout callout--note">
    <h4>The analogy, and where it breaks</h4>
    <p>A <strong>value type is a paper form</strong>. If I photocopy my form and hand you the
    copy, you can scribble on yours all day and mine is untouched. We have two forms.</p>
    <p>A <strong>reference type is a locker key</strong>. If I copy my key and hand it to you,
    we have two keys and <em>one locker</em>. Anything you put in the locker, I see.</p>
    <p>Where the analogy breaks: a key copy is cheap no matter how full the locker is, and
    that part is true — a reference is 8 bytes whatever it points at. But a paper form copy is
    also cheap, whereas copying a large value type genuinely costs proportionally more. Hold
    on to the sharing behaviour from this analogy and be sceptical of its cost model; the real
    cost model comes later in this module.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest example that shows the difference</h2>

  <p>Two types with identical contents. The only difference is the keyword.</p>

<pre data-lang="csharp" data-net="10" data-title="01-copy-semantics.cs" data-highlight="3,9"><code>Counter a = new Counter { Value = 1 };
Counter b = a;              // copies the data
b.Value = 99;
Console.WriteLine($"struct  -&gt; a.Value = {a.Value}, b.Value = {b.Value}");

CounterObject c = new CounterObject { Value = 1 };
CounterObject d = c;        // copies the reference, not the data
d.Value = 99;
Console.WriteLine($"class   -&gt; c.Value = {c.Value}, d.Value = {d.Value}");

struct Counter
{
    public int Value;
}

class CounterObject
{
    public int Value;
}</code></pre>

<pre data-lang="console" data-title="Output"><code>struct  -&gt; a.Value = 1, b.Value = 99
class   -&gt; c.Value = 99, d.Value = 99</code></pre>

  <p>Line 3 changed <code>b</code> and left <code>a</code> alone: two forms. Line 9 changed
  <code>d</code> and <code>c</code> changed too, because there was only ever one object and two
  keys to it.</p>

  <p>The same rule governs method calls, which is where it actually bites. A parameter is
  another variable, so passing an argument copies it under exactly the same rules.</p>

<pre data-lang="csharp" data-net="10" data-title="01-copy-semantics.cs (continued)"><code>Counter s = new Counter { Value = 1 };
BumpValue(s);
Console.WriteLine($"struct after BumpValue(s)      -&gt; {s.Value}");

BumpValueByRef(ref s);
Console.WriteLine($"struct after BumpValueByRef(s) -&gt; {s.Value}");

CounterObject o = new CounterObject { Value = 1 };
BumpObject(o);
Console.WriteLine($"class after BumpObject(o)      -&gt; {o.Value}");

CounterObject p = new CounterObject { Value = 1 };
ReplaceObject(p);
Console.WriteLine($"class after ReplaceObject(p)   -&gt; {p.Value}");

static void BumpValue(Counter counter) =&gt; counter.Value = 42;
static void BumpValueByRef(ref Counter counter) =&gt; counter.Value = 42;
static void BumpObject(CounterObject counter) =&gt; counter.Value = 42;
static void ReplaceObject(CounterObject counter) =&gt; counter = new CounterObject { Value = 42 };

struct Counter
{
    public int Value;
}

class CounterObject
{
    public int Value;
}</code></pre>

<pre data-lang="console" data-title="Output"><code>struct after BumpValue(s)      -&gt; 1
struct after BumpValueByRef(s) -&gt; 42
class after BumpObject(o)      -&gt; 42
class after ReplaceObject(p)   -&gt; 1</code></pre>

  <p class="define"><span class="define__term">ref</span> A keyword meaning "do not copy this
  argument — let the method work on the caller's own variable". It makes the parameter an
  <strong>alias</strong>: a second name for the same storage.</p>

  <p>Three of those four results follow directly from the copy rule. The fourth is the one that
  catches people, so read it slowly:</p>

  <ul>
    <li><code>BumpObject</code> <strong>changed the object</strong> the caller can see, because
    the copied key opens the same locker.</li>
    <li><code>ReplaceObject</code> <strong>did not</strong>, because it assigned a
    <em>new key</em> to its own local copy of the key. The caller's key still opens the original
    locker. Changing what is <em>inside</em> the locker is visible to the caller; swapping which
    locker your own key opens is not.</li>
  </ul>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>"Reference types are passed by reference" is a sentence you will hear constantly, and it
    is wrong. In C#, <strong>everything is passed by value by default</strong>. For a reference
    type, the thing being copied is the reference. That is precisely why
    <code>ReplaceObject</code> has no effect on the caller. If you want to reassign the caller's
    variable itself, you need <code>ref</code> — and that is as true for classes as it is
    for structs.</p>
  </div>
</section>

<section id="where-values-live">
  <h2>Where the data actually lives</h2>

  <p>Two more definitions, because the next part is where most explanations start lying.</p>

  <p class="define"><span class="define__term">Stack</span> A small, fast region of memory, one
  per thread, that works like a stack of plates: calling a method pushes a frame on top,
  returning pops it off. Everything in that frame vanishes instantly on return, with no cleanup
  work. Typically about 1&nbsp;MB per thread by default on Windows.</p>

  <p class="define"><span class="define__term">Heap</span> A large, general-purpose region of
  memory where objects live for as long as something still refers to them. It is not
  automatically cleaned when a method returns, so it needs the garbage collector.</p>

  <p class="define"><span class="define__term">Garbage collector (GC)</span> The part of .NET
  that periodically finds heap objects nothing refers to any more and reclaims their memory. It
  is automatic, and it is not free: to do its job it must briefly pause your threads. More heap
  allocation means more frequent pauses.</p>

  <p>Here is the sentence you will read in most tutorials: <em>"value types go on the stack,
  reference types go on the heap."</em> It is a useful first approximation and it is
  <strong>not true</strong>.</p>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>Claim:</strong> structs live on the stack.</p>
    <p><strong>Reality:</strong> a value lives wherever <em>the variable that holds it</em>
    lives. A local variable of struct type usually lives on the stack. A struct that is a
    <em>field of a class</em> lives on the heap, inside that object. A struct in an array lives
    on the heap, inside the array. A struct captured by a lambda or held across an
    <code>await</code> lives on the heap, inside a compiler-generated object. And a struct being
    actively worked on may live entirely in CPU registers and never touch memory at all.</p>
    <p>The reliable rule is: <strong>a value type is stored inline, wherever it is
    declared.</strong> That single sentence is both correct and more useful, because "stored
    inline" is what actually explains the performance behaviour.</p>
  </div>

  <p>Picture an <code>Invoice</code> object — a reference type — that has a <code>Total</code>
  field of value type <code>Money</code>, and a <code>Customer</code> field of reference type
  <code>Customer</code>.</p>

<pre class="diagram"><code>   STACK (this thread)                 HEAP (shared, GC-managed)
  +----------------------+            +--------------------------------+
  | invoice   [ key ]----+----------&gt; | Invoice object                 |
  |                      |            |  +--------------------------+  |
  | localTotal           |            |  | header + type pointer    |  |
  |   Amount   144.00    |            |  +--------------------------+  |
  |   Currency [ key ]---+---+        |  | Total (Money, INLINE)    |  |
  +----------------------+   |        |  |   Amount    144.00       |  |
                             |        |  |   Currency  [ key ]------+--+--+
   localTotal is a COPY.     |        |  +--------------------------+  |  |
   Changing it does not      |        |  | Customer   [ key ]-------+--+--|--+
   touch the invoice.        |        |  +--------------------------+  |  |  |
                             |        +--------------------------------+  |  |
                             |                                            |  |
                             +-----------&gt; "GBP" (string object) &lt;--------+  |
                                                                            |
                                        +--------------------------------+  |
                                        | Customer object                | &lt;-+
                                        +--------------------------------+</code></pre>

  <p>Read three things off that diagram, because each one is a rule you will use constantly:</p>

  <ol>
    <li>The <code>Money</code> value sits <strong>inside</strong> the Invoice object. It is not
    a separate heap object and it did not cost a separate allocation. This is the main
    performance argument for value types.</li>
    <li><code>localTotal</code> is a genuine copy. Writing to it cannot possibly affect the
    invoice — which is the source of the "my assignment did nothing" bug.</li>
    <li>The <code>Currency</code> string is a reference <em>inside</em> a value type. Value
    types are not automatically "all value" all the way down. A struct containing a reference
    still points out to the heap.</li>
  </ol>

  <p>You can measure the sizes rather than trust a diagram.</p>

<pre data-lang="csharp" data-net="10" data-title="02-sizes-and-boxing.cs"><code>using System.Runtime.CompilerServices;

Console.WriteLine($"int          {Unsafe.SizeOf&lt;int&gt;(),3} bytes");
Console.WriteLine($"Money        {Unsafe.SizeOf&lt;Money&gt;(),3} bytes");
Console.WriteLine($"LedgerEntry  {Unsafe.SizeOf&lt;LedgerEntry&gt;(),3} bytes");
Console.WriteLine($"a reference  {IntPtr.Size,3} bytes");

public readonly record struct Money(decimal Amount, string Currency);

public readonly record struct LedgerEntry(
    Guid Id,
    Money Amount,
    DateTimeOffset PostedAt,
    long SequenceNumber);</code></pre>

<pre data-lang="console" data-title="Output (x64)"><code>int            4 bytes
Money         24 bytes
LedgerEntry   64 bytes
a reference    8 bytes</code></pre>

  <p><code>Money</code> is 24 bytes: 16 for the <code>decimal</code> plus 8 for the string
  reference. A reference is 8 bytes on a 64-bit process regardless of what it points at. Keep
  those two numbers in mind — they are the whole basis of the "when should this be a struct"
  decision later.</p>
</section>

<section id="production-example">
  <h2>The same idea in a real service</h2>

  <p>Here is the distinction doing actual work. This is the Ledger domain used throughout this
  curriculum: a payments and invoicing service.</p>

  <p>The decision to make for each type is one question: <strong>is this thing a measurement,
  or is it a thing?</strong></p>

  <ul>
    <li>An amount of money is a <em>measurement</em>. £144.00 is £144.00. Two of them with the
    same amount and currency are not merely equal, they are interchangeable. There is no such
    thing as "this particular £144.00 as opposed to that one". That is a value type.</li>
    <li>An invoice is a <em>thing</em>. Two invoices can carry identical numbers and still be
    different invoices — you can amend one and not the other, and it matters which one you
    emailed. That is a reference type.</li>
  </ul>

  <p class="define"><span class="define__term">Identity</span> The property of being a specific
  thing, distinguishable from another thing that happens to look identical. Reference types have
  identity; value types do not.</p>

<pre data-lang="csharp" data-net="10" data-title="04-ledger-money-and-invoice.cs"><code>/// &lt;summary&gt;An amount in a single currency. Immutable, compared by value.&lt;/summary&gt;
public readonly record struct Money(decimal Amount, string Currency)
{
    public static Money Zero(string currency) =&gt; new Money(0m, currency);

    public static Money operator +(Money left, Money right)
    {
        Require(left, right);
        return new Money(left.Amount + right.Amount, left.Currency);
    }

    public static Money operator -(Money left, Money right)
    {
        Require(left, right);
        return new Money(left.Amount - right.Amount, left.Currency);
    }

    public static Money operator *(Money value, decimal factor) =&gt;
        new Money(decimal.Round(value.Amount * factor, 2, MidpointRounding.ToEven), value.Currency);

    private static void Require(Money left, Money right)
    {
        if (!string.Equals(left.Currency, right.Currency, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Cannot combine {left.Currency} with {right.Currency}.");
        }
    }

    public override string ToString() =&gt; $"{Amount:0.00} {Currency}";
}

/// &lt;summary&gt;A specific invoice. Has identity and changes over its lifetime.&lt;/summary&gt;
public sealed class Invoice
{
    private readonly List&lt;InvoiceLine&gt; _lines = new List&lt;InvoiceLine&gt;();

    public Invoice(string number, string customerId)
    {
        Number = number;
        CustomerId = customerId;
    }

    public string Number { get; }
    public string CustomerId { get; }
    public IReadOnlyList&lt;InvoiceLine&gt; Lines =&gt; _lines;

    public Money Total
    {
        get
        {
            Money running = Money.Zero("GBP");
            foreach (InvoiceLine line in _lines)
            {
                running += line.Amount;
            }
            return running;
        }
    }

    public void AddLine(string description, Money amount) =&gt;
        _lines.Add(new InvoiceLine(description, amount));
}

public readonly record struct InvoiceLine(string Description, Money Amount);</code></pre>

  <p>Driving it:</p>

<pre data-lang="csharp" data-net="10" data-title="04-ledger-money-and-invoice.cs (usage)"><code>Money subtotal = new Money(120.00m, "GBP");
Money vat = subtotal * 0.20m;
Money total = subtotal + vat;

Console.WriteLine($"total    = {total}");

// Value equality: two separately-created Money values are the same value.
Money a = new Money(144.00m, "GBP");
Money b = new Money(144.00m, "GBP");
Console.WriteLine($"a == b                  -&gt; {a == b}");

// Reference identity: two invoices with identical contents are still two invoices.
Invoice one = new Invoice("INV-1001", "CUST-7");
Invoice two = new Invoice("INV-1001", "CUST-7");
Console.WriteLine($"one == two              -&gt; {one == two}");

one.AddLine("Consulting, March", new Money(120.00m, "GBP"));
one.AddLine("Hosting, March", new Money(24.00m, "GBP"));

// The names alias and one refer to the SAME invoice on the heap.
Invoice alias = one;
alias.AddLine("Support retainer", new Money(50.00m, "GBP"));

Console.WriteLine($"one.Lines.Count         -&gt; {one.Lines.Count}");
Console.WriteLine($"one.Total               -&gt; {one.Total}");</code></pre>

<pre data-lang="console" data-title="Output"><code>total    = 144.00 GBP
a == b                  -&gt; True
one == two              -&gt; False
one.Lines.Count         -&gt; 3
one.Total               -&gt; 194.00 GBP</code></pre>

  <p>Note <code>alias</code>. Adding a line through it changed <code>one</code>, because they
  are the same invoice. That is exactly what you want for an entity and exactly what you do not
  want for an amount of money.</p>

  <p class="define"><span class="define__term">readonly record struct</span> Three things at
  once. <code>struct</code> makes it a value type. <code>record</code> makes the compiler write
  value-based <code>Equals</code>, <code>GetHashCode</code>, <code>ToString</code>, and
  <code>==</code> for you. <code>readonly</code> promises no member ever changes the value after
  construction. For a domain value like <code>Money</code> this combination is the default you
  should reach for, and the rest of this module explains why each of the three words is
  earning its place.</p>
</section>

<section id="boxing">
  <h2>Boxing: when a value type visits the heap</h2>

  <p>A value type is stored inline. But plenty of APIs are typed as <code>object</code>, or as
  an interface. Those need a reference — something on the heap to point at. So the runtime has
  to manufacture one.</p>

  <p class="define"><span class="define__term">Boxing</span> Wrapping a value type in a
  newly-allocated heap object so it can be treated as a reference. It costs one allocation and
  one copy, every time.</p>

  <p class="define"><span class="define__term">Unboxing</span> Copying the value back out of
  that heap object. It requires a type check and can throw
  <code>InvalidCastException</code>.</p>

<pre data-lang="csharp" data-net="10" data-title="02-sizes-and-boxing.cs"><code>long before = GC.GetAllocatedBytesForCurrentThread();
object boxed = 42;                       // boxing: allocates
long after = GC.GetAllocatedBytesForCurrentThread();

Console.WriteLine($"boxing one int allocated {after - before} bytes on the heap");
Console.WriteLine($"unboxing it back gives   {(int)boxed}");</code></pre>

<pre data-lang="console" data-title="Output (x64)"><code>boxing one int allocated 24 bytes on the heap
unboxing it back gives   42</code></pre>

  <p>Twenty-four bytes to store a four-byte number. The overhead is structural, not wasteful
  design: every heap object carries an 8-byte header and an 8-byte pointer to its type
  information before its actual data starts, and the result is rounded up to an 8-byte
  boundary. That is the minimum price of being addressable on the heap.</p>

  <p>One boxed <code>int</code> is irrelevant. A million of them is not.</p>

<pre data-lang="csharp" data-net="10" data-title="03-allocation-pressure.cs"><code>const int N = 1_000_000;

long before = GC.GetAllocatedBytesForCurrentThread();
List&lt;object&gt; boxedList = new List&lt;object&gt;(N);
for (int i = 0; i &lt; N; i++)
{
    boxedList.Add(i);                    // boxes every single one
}
long after = GC.GetAllocatedBytesForCurrentThread();
Console.WriteLine($"List&lt;object&gt; of {N:N0} ints: {(after - before) / 1024.0 / 1024.0:F1} MB");

before = GC.GetAllocatedBytesForCurrentThread();
List&lt;int&gt; intList = new List&lt;int&gt;(N);
for (int i = 0; i &lt; N; i++)
{
    intList.Add(i);                      // stored inline in one array
}
after = GC.GetAllocatedBytesForCurrentThread();
Console.WriteLine($"List&lt;int&gt;    of {N:N0} ints: {(after - before) / 1024.0 / 1024.0:F1} MB");

Console.WriteLine($"Gen 0 collections so far: {GC.CollectionCount(0)}");</code></pre>

<pre data-lang="console" data-title="Output (x64, .NET 10)"><code>List&lt;object&gt; of 1,000,000 ints: 30.5 MB
List&lt;int&gt;    of 1,000,000 ints: 3.8 MB
Gen 0 collections so far: 6</code></pre>

  <p><strong>Eight times the memory</strong>, plus a million individual objects the garbage
  collector now has to trace, plus six collection pauses that the generic version largely
  avoids. The generic <code>List&lt;int&gt;</code> stores all million values inline in a single
  array.</p>

  <p>This is the concrete reason generics exist. Before generics, every collection was a
  collection of <code>object</code>, so every number you put in one was boxed.</p>

  <div class="callout callout--gotcha">
    <h4>Where boxing hides in ordinary-looking code</h4>
    <p>Boxing is almost never written on purpose. It sneaks in:</p>
    <ul>
      <li><strong>Structured logging.</strong>
      <code>logger.LogInformation("Processed {Count} rows", count)</code> takes
      <code>params object?[]</code>. That integer is boxed, and an array is allocated, on
      every call — including calls that are filtered out by log level. This is why the
      <code>LoggerMessage</code> source generator exists.</li>
      <li><strong>Calling an interface method on a struct</strong> through an interface-typed
      variable. <code>IComparable c = 5;</code> boxes.</li>
      <li><strong>Old non-generic collections</strong> — <code>ArrayList</code>,
      <code>Hashtable</code>. If you see them in a codebase, they are boxing.</li>
      <li><strong><code>string.Format</code> and interpolation into <code>object</code>
      parameters.</strong> Modern interpolated string handlers avoid much of this, but only
      where the API opts in.</li>
      <li><strong><code>enum.HasFlag</code></strong> boxed on .NET Framework. It does not on
      modern .NET — this one is genuinely fixed, and repeating the old advice is now wrong.</li>
    </ul>
  </div>

  <p>The escape hatch is a generic type parameter with a constraint, because the JIT compiles a
  separate specialised version of the method for each value type, calling the method directly
  with no heap object involved.</p>

<pre data-lang="csharp" data-net="10" data-title="Boxing vs not"><code>// Boxes on every call: the parameter is an interface, so it needs a reference.
static int CompareBoxed(IComparable&lt;int&gt; left, int right) =&gt; left.CompareTo(right);

// Does not box: T is known to be int at JIT time, so the call is direct.
static int CompareFree&lt;T&gt;(T left, T right) where T : IComparable&lt;T&gt; =&gt; left.CompareTo(right);</code></pre>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <p>Now the failure modes, in the order you are likely to meet them.</p>

  <h3>1. The mutation that silently disappears</h3>

  <p>This is the invoice bug from the opening. A value type that can be modified after
  construction is called a <strong>mutable struct</strong>, and it is the single most reliable
  source of "the line ran but nothing happened" in C#.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Do not do this"><code>struct MutableCounter
{
    public int Count;
    public void Increment() =&gt; Count++;
}

class Holder
{
    public MutableCounter WritableField;
    public readonly MutableCounter ReadonlyField;
}

Holder holder = new Holder();
holder.WritableField.Increment();
holder.ReadonlyField.Increment();   // compiles, runs, and does nothing</code></pre>

<pre data-lang="console" data-title="Output"><code>1. writable field  -&gt; 1
1. readonly field  -&gt; 0   &lt;-- mutation lost</code></pre>

  <p class="define"><span class="define__term">Defensive copy</span> A hidden copy the compiler
  inserts when you call a method on a value type it must protect from modification. The method
  runs against the copy, the copy is discarded, and your change evaporates. No warning, no
  error.</p>

  <p>The compiler does this because <code>ReadonlyField</code> is declared
  <code>readonly</code>, and it cannot prove <code>Increment()</code> will not modify the value.
  So it copies first to keep the promise. The same thing happens with <code>in</code>
  parameters, which are the <code>readonly</code> equivalent for arguments:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Same trap, via an in parameter"><code>static void IncrementThroughIn(in MutableCounter counter) =&gt; counter.Increment();

MutableCounter viaIn = new MutableCounter();
IncrementThroughIn(in viaIn);
Console.WriteLine($"2. in parameter    -&gt; {viaIn.Count}");   // 0</code></pre>

  <p>The fix is not to memorise where defensive copies happen. The fix is to make the type
  <code>readonly struct</code>, which promises the compiler no member mutates, so it stops
  making the copies — and the compiler will then reject any member that tries to.</p>

<pre data-lang="csharp" data-net="10" data-title="05-defensive-copies.cs — the fix"><code>readonly struct SafeCounter
{
    public SafeCounter(int count) =&gt; Count = count;

    public int Count { get; }

    // Returns a new value instead of mutating this one.
    public SafeCounter Increment() =&gt; new SafeCounter(Count + 1);
}

SafeCounter safe = new SafeCounter(0);
SafeCounter safeIncremented = safe.Increment();
Console.WriteLine($"original {safe.Count}, returned {safeIncremented.Count}");</code></pre>

<pre data-lang="console" data-title="Output"><code>original 0, returned 1</code></pre>

  <p>Because the result must be assigned to something, the compiler now catches the bug for
  you: <code>safe.Increment();</code> on its own produces a warning that the result is unused,
  where the mutable version silently did nothing.</p>

  <h3>2. Collections hand you copies</h3>

  <p>The same trap with a different face. Whether you can mutate an element in place depends on
  whether the container gives you back a <em>variable</em> or a <em>value</em>.</p>

<pre data-lang="csharp" data-net="10" data-title="05-defensive-copies.cs"><code>// Arrays hand back a direct reference to the element, so this really mutates.
MutableCounter[] array = new MutableCounter[1];
array[0].Increment();
array[0].Increment();
Console.WriteLine($"3. array element   -&gt; {array[0].Count}");   // 2

// A List&lt;T&gt; indexer is a method returning a copy, so iterating gives copies too.
List&lt;MutableCounter&gt; list = new List&lt;MutableCounter&gt; { new MutableCounter() };
foreach (MutableCounter item in list)
{
    item.Increment();                                            // mutates a copy
}
Console.WriteLine($"3. list via foreach-&gt; {list[0].Count}");     // 0</code></pre>

<pre data-lang="console" data-title="Output"><code>3. array element   -&gt; 2   &lt;-- array mutation works
3. list via foreach-&gt; 0   &lt;-- mutation lost</code></pre>

  <p>Sometimes the compiler saves you. Assigning to a field through a copy is a hard error,
  and it is worth knowing the number because you will meet it:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="07-compile-error-probe.cs"><code>list[0].Count = 5;          // CS1612
box.Counter.Count = 5;      // CS1612 (auto-property getter returns a copy)</code></pre>

<pre data-lang="console" data-title="Compiler output"><code>error CS1612: Cannot modify the return value of 'List&lt;MutableCounter&gt;.this[int]'
              because it is not a variable
error CS1612: Cannot modify the return value of 'Box.Counter'
              because it is not a variable</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>Notice the asymmetry, because it is genuinely nasty. <code>list[0].Count = 5;</code> is a
    <strong>compile error</strong>. <code>list[0].Increment();</code> compiles cleanly and
    silently does nothing. The compiler only protects you from the direct assignment, not from
    a method that mutates internally. This is the strongest practical argument for never
    writing a mutable struct in the first place.</p>
  </div>

  <p>If you genuinely need in-place mutation of value types in a list — and in hot code you
  sometimes do — there are three real tools, all of which work by handing you a variable rather
  than a copy.</p>

<pre data-lang="csharp" data-net="10" data-title="08-mutating-in-place.cs"><code>using System.Runtime.InteropServices;

List&lt;Tally&gt; tallies = new List&lt;Tally&gt;
{
    new Tally { Name = "gbp", Count = 0 },
    new Tally { Name = "usd", Count = 0 }
};

// 1. CollectionsMarshal.AsSpan gives a window onto the list's own backing array.
Span&lt;Tally&gt; span = CollectionsMarshal.AsSpan(tallies);
for (int i = 0; i &lt; span.Length; i++)
{
    span[i].Count += 10;
}
Console.WriteLine($"after AsSpan      -&gt; {tallies[0].Count}, {tallies[1].Count}");

// 2. A ref local is an alias for an existing storage location.
Tally[] array = new Tally[] { new Tally { Name = "eur", Count = 5 } };
ref Tally slot = ref array[0];
slot.Count += 100;
Console.WriteLine($"after ref local   -&gt; {array[0].Count}");

// 3. foreach over a Span hands out ref elements, unlike foreach over a List.
foreach (ref Tally tally in CollectionsMarshal.AsSpan(tallies))
{
    tally.Count += 1;
}
Console.WriteLine($"after ref foreach -&gt; {tallies[0].Count}, {tallies[1].Count}");

// The boring alternative that is usually the right answer: read, change, write back.
tallies[0] = tallies[0] with { Count = 999 };
Console.WriteLine($"after write-back  -&gt; {tallies[0].Count}");

record struct Tally
{
    public string Name { get; set; }
    public int Count { get; set; }
}</code></pre>

<pre data-lang="console" data-title="Output"><code>after AsSpan      -&gt; 10, 10
after ref local   -&gt; 105
after ref foreach -&gt; 11, 11
after write-back  -&gt; 999</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><code>CollectionsMarshal.AsSpan</code> points directly at the list's internal array. If
    anything adds to or removes from the list while you hold that span, the list may replace its
    array and your span is now pointing at the old one — you will read and write stale data with
    no exception. Use it only for a tight loop that does not touch the list's size.</p>
  </div>

  <h3>3. Equality you did not write, and did not want</h3>

  <p>A plain <code>struct</code> with no <code>Equals</code> override still supports
  <code>Equals</code> and <code>GetHashCode</code>, inherited from <code>ValueType</code>. If
  the struct contains only simple numeric fields, the runtime can compare its bytes directly and
  it is fast. If it contains <strong>any reference field</strong> — a <code>string</code>, most
  commonly — that fast path is unavailable and the runtime falls back to comparing fields via
  reflection.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="06-struct-equality-cost.cs — the slow key"><code>struct SlowKey
{
    public int Id;
    public string Code;        // a reference field: forces the reflection path
}

readonly record struct FastKey(int Id, string Code);   // compiler-generated equality</code></pre>

  <p>Using each as a dictionary key, 50,000 entries, 500,000 lookups, Release build:</p>

<pre data-lang="console" data-title="Output (x64, .NET 10, Release)"><code>struct with default equality :     54 ms for 500,000 lookups
readonly record struct       :     10 ms for 500,000 lookups
ratio                        : 5.4x</code></pre>

  <p>About <strong>five times slower</strong>, and it repeats across runs — a second run gave
  80&nbsp;ms against 16&nbsp;ms, the same ratio. Absolute milliseconds depend on the machine;
  the ratio is the finding.</p>

  <p>Making it a <code>record struct</code> is a one-word fix, because the compiler then
  generates a real <code>Equals</code> and <code>GetHashCode</code> that compare the fields
  directly. If you cannot use a record, implement <code>IEquatable&lt;T&gt;</code> by hand and
  override <code>GetHashCode</code>.</p>

  <h3>4. Copying that is no longer cheap</h3>

  <p>Copying a value type copies every byte. For <code>int</code> that is nothing. For a struct
  with twelve fields, passed through five layers of call stack in a loop running a million
  times, it is real work — and unlike a heap allocation it does not show up in any allocation
  profiler, so it is easy to miss.</p>

  <p>This is where the widely-quoted "keep structs under 16 bytes" guidance comes from. Treat
  it as a prompt to measure, not a law: a 64-byte <code>readonly struct</code> passed by
  <code>in</code> and never copied can beat a class comfortably, because it costs no allocation
  and no GC tracing.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>Symptom: "I set the property and it didn't change"</h4>
    <ol>
      <li><strong>Check the type kind first.</strong> In Visual Studio or Rider, go to
      definition on the type. Does it say <code>struct</code> or <code>class</code>? If
      <code>struct</code>, you are looking at a copy problem, not a logic problem. In VS Code
      with C# Dev Kit, hover shows the same.</li>
      <li><strong>Find the copy.</strong> Work backwards from the failing line and ask at each
      step: did this come from a property getter, a <code>List</code> indexer, a
      <code>foreach</code> variable, a method parameter without <code>ref</code>, a
      <code>readonly</code> field, or an <code>in</code> parameter? Each of those is a copy
      boundary.</li>
      <li><strong>Confirm with the debugger.</strong> Put a watch on the original and on the
      thing you are mutating. If the original's fields never change while the other's do, the
      copy is confirmed.</li>
      <li><strong>Fix by making the type immutable</strong>, not by hunting the copy. Convert to
      <code>readonly record struct</code> and return new values. The bug becomes impossible
      rather than avoided.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: high memory, frequent gen-0 collections</h4>
    <ol>
      <li><strong>Watch the counters live</strong> against a running process:
<pre data-lang="bash" data-title="terminal"><code>dotnet-counters monitor --process-id 1234 --counters System.Runtime</code></pre>
      Look at <code>alloc-rate</code> (bytes per second) and <code>gen-0-gc-count</code>. An
      allocation rate in the hundreds of MB per second on a service that is not moving much data
      means something in the hot path is allocating per item.</li>
      <li><strong>Find what is allocating.</strong> Capture a heap snapshot and look at the
      object counts:
<pre data-lang="bash" data-title="terminal"><code>dotnet-gcdump collect --process-id 1234</code></pre>
      A huge count of <code>System.Int32</code>, <code>System.Boolean</code>, or
      <code>System.DateTime</code> instances on the heap is the signature of boxing — those
      types cannot be on the heap otherwise.</li>
      <li><strong>Confirm with a benchmark</strong> before and after. Add
      <code>[MemoryDiagnoser]</code> to a BenchmarkDotNet class and read the
      <strong>Allocated</strong> column. It reports bytes per operation, which is far more
      actionable than total process memory.</li>
      <li><strong>Check the obvious sources in order:</strong> non-generic collections,
      <code>object</code> parameters, LINQ over value types through interfaces, and logging
      calls in hot loops.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Reading it straight from the compiler</h4>
    <p>When you want certainty about whether something boxes, look at the IL. Boxing is a
    single instruction named <code>box</code>, so it cannot hide. Paste the method into
    sharplab.io (offline alternative: <code>ildasm</code>, or ILSpy) and search for
    <code>box</code>. Seeing the instruction appear and disappear as you change a signature
    from <code>object</code> to a constrained generic is the fastest way to make this
    permanent knowledge.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>A payment reconciliation job at Ledger imports a bank statement every night: about
    <strong>2 million transaction rows</strong>. Each row is parsed, matched against an invoice,
    and totalled. The first version modelled a row as a <code>class</code> with an
    <code>int</code> account, a <code>decimal</code> amount, and a <code>DateTime</code>, and
    accumulated results in a <code>Dictionary&lt;AccountKey, decimal&gt;</code> where
    <code>AccountKey</code> was a plain struct holding an <code>int</code> and a
    <code>string</code>.</p>
    <p>Measured behaviour of that version:</p>
    <ul>
      <li>2 million row objects, each with a 16-byte header, allocated and immediately garbage
      — roughly <strong>96 MB of pure overhead</strong> before any actual data.</li>
      <li>The <code>AccountKey</code> struct hit the reflection-based equality path on every
      dictionary lookup, at the <strong>~5x</strong> cost measured earlier in this module.</li>
      <li>Gen-0 collections every few hundred milliseconds. On server GC each one pauses every
      worker thread. The job ran for <strong>34 minutes</strong> and pushed the container past
      its 2&nbsp;GB memory limit twice, each time restarting the job from the beginning.</li>
    </ul>
    <p>Two changes, neither of them clever: the row became a <code>readonly record struct</code>
    processed from a pooled buffer, so rows were stored inline and never individually allocated;
    and <code>AccountKey</code> became a <code>readonly record struct</code>, so equality
    stopped using reflection.</p>
    <p>Result: allocation dropped by roughly an order of magnitude, gen-0 collections became
    rare, peak memory settled near <strong>300 MB</strong>, and the job finished in
    <strong>under 6 minutes</strong> without restarts.</p>
    <p>No algorithm changed. The work done was identical. The only difference was where the
    data lived and how it was compared — which is the entire content of this module.</p>
  </div>

  <p>The interview version of this: if you are asked "when would you use a struct over a
  class", the shallow answer is "for small, short-lived data". The answer that shows you have
  operated a system is: <em>"When the type is a value with no identity, and when storing it
  inline removes an allocation from a path that runs often enough for allocation rate to matter.
  I would confirm with a MemoryDiagnoser benchmark, because a large struct copied repeatedly
  can easily be slower than the class it replaced."</em></p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Structs are always faster than classes."</strong></p>
    <p>No. Structs avoid an allocation, which is usually the win. But they are copied on every
    assignment, every parameter pass, and every return. Past roughly 16–24 bytes, and
    especially when passed around a deep call stack, the copying can cost more than the
    allocation it saved. Structs also cannot be shared, so any "update" means copying the whole
    thing. Measure.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Value types go on the stack."</strong></p>
    <p>Covered above, and worth repeating because it is so widespread: value types are stored
    <em>inline, wherever the variable lives</em>. Struct fields of a class are on the heap.
    Struct elements of an array are on the heap. Locals captured by a lambda or held across an
    <code>await</code> are on the heap. The stack is one possible location, not the
    definition.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>string</code> is a value type because it behaves like one."</strong></p>
    <p><code>string</code> is a reference type. It <em>feels</em> like a value type because it
    is immutable — you can never observe a shared string changing underneath you, so sharing is
    undetectable. Immutability, not the value/reference distinction, is what makes it safe. This
    is the pattern worth stealing: an immutable reference type gets most of the safety of a
    value type without the copying cost.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>ref</code> and reference types are the same idea."</strong></p>
    <p>They are two independent levels. A reference type variable holds a reference to an object.
    <code>ref</code> makes a variable an alias for another <em>variable</em>. You can have
    <code>ref</code> on a struct parameter (alias to a value) and <code>ref</code> on a class
    parameter (alias to the caller's reference variable, letting you reassign it). The proof is
    <code>ReplaceObject</code> earlier in this module.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Making everything a struct after reading a performance article.</strong></p>
    <p>The failure mode is predictable: entities acquire identity requirements later, structs
    get passed through interfaces and start boxing, mutable structs generate silent-copy bugs,
    and equality quietly runs through reflection. The result is a codebase that is both slower
    and buggier than the one that used classes. Default to <code>class</code> for things with
    identity and <code>readonly record struct</code> for values, then optimise the paths a
    profiler actually points at.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <p>A decision procedure you can apply without thinking hard, which is the point of having
  one.</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Question</th><th>If yes</th><th>Because</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>Do two of these with identical contents mean the same thing?</td>
          <td><code>readonly record struct</code></td>
          <td>It is a value. Money, a date range, a coordinate, a quantity.</td>
        </tr>
        <tr>
          <td>Does it have an identity that survives its contents changing?</td>
          <td><code>class</code></td>
          <td>It is an entity. An invoice, a customer, a database connection.</td>
        </tr>
        <tr>
          <td>Does it need to change after construction, in place, seen by others?</td>
          <td><code>class</code></td>
          <td>Mutable value types are the silent-copy bug factory.</td>
        </tr>
        <tr>
          <td>Is it bigger than about 24 bytes and passed around a lot?</td>
          <td><code>class</code>, or <code>in</code></td>
          <td>Copy cost starts to outweigh the saved allocation.</td>
        </tr>
        <tr>
          <td>Will it be stored as <code>object</code> or reached through an interface?</td>
          <td><code>class</code></td>
          <td>It would box constantly, losing every advantage.</td>
        </tr>
        <tr>
          <td>Is it created in enormous numbers in a hot loop?</td>
          <td><code>readonly record struct</code></td>
          <td>Inline storage removes the allocation and the GC tracing.</td>
        </tr>
        <tr>
          <td>Does it need inheritance?</td>
          <td><code>class</code></td>
          <td>Structs cannot inherit from another struct or class.</td>
        </tr>
        <tr>
          <td>Does it need to be <code>null</code>?</td>
          <td><code>class</code>, or <code>Nullable</code></td>
          <td>A struct always has a value; <code>Money?</code> works but adds a flag byte.</td>
        </tr>
      </tbody>
    </table>
  </div>

  <p class="define"><span class="define__term">null</span> A reference that points at nothing.
  Only reference types (and <code>Nullable</code> value types, written <code>int?</code>) can be
  <code>null</code>. A plain struct variable always holds a real value — a fresh one is all
  zeroes, not "empty". This is why <code>default(Money)</code> gives you 0.00 with a
  <code>null</code> currency rather than nothing at all, which is a trap worth remembering.</p>

  <div class="callout callout--note">
    <h4>Version note</h4>
    <p>Everything here targets <strong>.NET 10</strong>. The behaviour described is stable
    across .NET 8, 9, and 10 — copy semantics, boxing, and defensive copies have not changed.
    Two things to be careful about when reading older material: <code>enum.HasFlag</code> boxed
    on .NET Framework but does not on modern .NET, and <code>record struct</code> requires C# 10
    or later (.NET 6+). The file-based <code>dotnet run Program.cs</code> style used in the
    verification sources is a .NET 10 feature; on .NET 8 or 9 put the same code in a console
    project.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>Predict the output of the program below <em>before</em> running it, then run it. Write
    one sentence for each line explaining which rule produced it.</p>
<pre data-lang="csharp" data-net="10"><code>Point p1 = new Point { X = 1 };
Point p2 = p1;
p2.X = 5;

Line l1 = new Line { Start = new Point { X = 1 } };
Line l2 = l1;
l2.Start = new Point { X = 5 };

Console.WriteLine($"{p1.X} {p2.X} {l1.Start.X} {l2.Start.X}");

struct Point { public int X; }
class Line { public Point Start; }</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>Output: <code>1 5 5 5</code></p>
        <ul>
          <li><code>p1.X</code> is <strong>1</strong>. <code>Point</code> is a struct, so
          <code>p2 = p1</code> copied it. Writing to <code>p2</code> cannot reach
          <code>p1</code>.</li>
          <li><code>p2.X</code> is <strong>5</strong>. That is the copy we changed.</li>
          <li><code>l1.Start.X</code> is <strong>5</strong>. <code>Line</code> is a class, so
          <code>l2 = l1</code> copied only the reference. There is one <code>Line</code> object
          and two names for it.</li>
          <li><code>l2.Start.X</code> is <strong>5</strong> — the same object, read through the
          other name.</li>
        </ul>
        <p>The trap is assuming that because <code>Point</code> is a value type, the
        <code>Start</code> field is somehow protected. It is not. The <code>Point</code> lives
        <em>inside</em> the shared <code>Line</code> object on the heap, so anyone with a
        reference to the line can overwrite it. Value semantics apply to the variable you copy,
        not to everything nested underneath it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>The type below is used as a dictionary key and as a field of a class. It contains at
    least four separate problems covered in this module. Find them all, explain the symptom each
    one produces, and rewrite the type correctly.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public struct AccountKey
{
    public int TenantId;
    public string AccountNumber;

    public void Normalise()
    {
        AccountNumber = AccountNumber.Trim().ToUpperInvariant();
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Problem 1 — public mutable fields.</strong> Anyone can change
        <code>TenantId</code> after the key is in a dictionary. A dictionary places a key in a
        bucket chosen from its hash code at insert time; changing the key afterwards does not
        move it. The entry becomes unreachable by lookup but still present when enumerating —
        the dictionary is silently corrupted.</p>

        <p><strong>Problem 2 — <code>Normalise()</code> mutates a struct.</strong> Called on a
        <code>readonly</code> field, an <code>in</code> parameter, a property result, or a
        <code>List</code> element, it operates on a defensive copy and does nothing. The caller
        sees un-normalised data with no error.</p>

        <p><strong>Problem 3 — no <code>Equals</code>/<code>GetHashCode</code>.</strong> It
        falls back to <code>ValueType</code>, and because <code>AccountNumber</code> is a
        reference field the fast byte-comparison path is unavailable, so equality runs through
        reflection — the ~5x penalty measured earlier, on every single lookup.</p>

        <p><strong>Problem 4 — case-sensitive string equality by default.</strong> Even once
        equality is correct, <code>"gb-001"</code> and <code>"GB-001"</code> hash differently.
        That is exactly what <code>Normalise</code> was trying to fix, and it was trying to fix
        it at the wrong time — after construction rather than during it.</p>

        <p>The corrected version normalises once, in the constructor, and can never change
        afterwards:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public readonly record struct AccountKey
{
    public AccountKey(int tenantId, string accountNumber)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(accountNumber);

        TenantId = tenantId;
        AccountNumber = accountNumber.Trim().ToUpperInvariant();
    }

    public int TenantId { get; }
    public string AccountNumber { get; }
}</code></pre>
        <p>Every problem is now structurally impossible rather than merely avoided.
        <code>record</code> generates correct value equality and hashing;
        <code>readonly</code> removes defensive copies and forbids mutating members;
        get-only properties prevent post-construction change; and normalisation happens once,
        at the only point where the value comes into existence.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Write a program that proves, with numbers rather than assertion, that passing a
    64-byte struct by value is measurably more expensive than passing it by <code>in</code>.
    Then explain why using <code>in</code> on a <em>non-readonly</em> struct could make things
    worse rather than better.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
<pre data-lang="csharp" data-net="10" data-title="Run with: dotnet run -c Release copies.cs"><code>using System.Diagnostics;

const int Iterations = 200_000_000;

Big value = new Big(1);

// Warm up so the JIT has compiled both paths before timing.
_ = SumByValue(value, 1000);
_ = SumByIn(in value, 1000);

Stopwatch sw = Stopwatch.StartNew();
long a = SumByValue(value, Iterations);
sw.Stop();
long byValueMs = sw.ElapsedMilliseconds;

sw.Restart();
long b = SumByIn(in value, Iterations);
sw.Stop();
long byInMs = sw.ElapsedMilliseconds;

Console.WriteLine($"by value : {byValueMs,5} ms  (checksum {a})");
Console.WriteLine($"by in    : {byInMs,5} ms  (checksum {b})");

static long SumByValue(Big big, int times)
{
    long total = 0;
    for (int i = 0; i &lt; times; i++)
    {
        total += big.A;
    }
    return total;
}

static long SumByIn(in Big big, int times)
{
    long total = 0;
    for (int i = 0; i &lt; times; i++)
    {
        total += big.A;
    }
    return total;
}

readonly struct Big
{
    public Big(long seed)
    {
        A = seed; B = seed; C = seed; D = seed;
        E = seed; F = seed; G = seed; H = seed;
    }

    public long A { get; }
    public long B { get; }
    public long C { get; }
    public long D { get; }
    public long E { get; }
    public long F { get; }
    public long G { get; }
    public long H { get; }
}</code></pre>
        <p>The by-value version copies 64 bytes into the parameter slot on every call; the
        <code>in</code> version passes an 8-byte reference. With the loop <em>inside</em> the
        method the copy happens once, so to see the difference clearly you should also try
        moving the loop to the caller so the call itself is what repeats.</p>

        <p><strong>Why <code>in</code> on a non-readonly struct can be worse:</strong>
        <code>in</code> promises the callee will not modify the argument. If the struct is not
        declared <code>readonly</code>, the compiler cannot prove that any member call keeps that
        promise — so at <em>every member access</em> it inserts a defensive copy of the whole
        struct. You asked to avoid one 64-byte copy at the call and bought yourself a 64-byte
        copy per property read inside the loop. That turns an optimisation into a serious
        regression.</p>

        <p>The rule that follows: <strong><code>in</code> is only safe on
        <code>readonly struct</code></strong>. If the type is not readonly, either make it
        readonly or pass it by value. This is also why <code>readonly</code> on a struct is a
        performance feature and not merely documentation.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>The method below is called roughly 50,000 times per second in production. It allocates
    on every call even though it appears to create nothing. Identify every allocation, then
    rewrite it to allocate nothing on the common path.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public bool TryProcess(int accountId, decimal amount, DateTime postedAt)
{
    _logger.LogDebug("Processing {AccountId} for {Amount} at {PostedAt}",
        accountId, amount, postedAt);

    IComparable&lt;decimal&gt; comparable = amount;
    if (comparable.CompareTo(0m) &lt;= 0)
    {
        return false;
    }

    var key = new object[] { accountId, postedAt.Date };
    return _seen.Add(string.Join("-", key));
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The allocations, in order:</strong></p>
        <ol>
          <li><code>LogDebug</code> takes <code>params object?[]</code>. That is
          <strong>one array plus three boxes</strong> (<code>int</code>, <code>decimal</code>,
          <code>DateTime</code>) on every call — and critically, they happen even when Debug
          logging is disabled, because the arguments are evaluated before the call.</li>
          <li><code>IComparable&lt;decimal&gt; comparable = amount;</code> <strong>boxes the
          decimal</strong> purely to call a method that <code>decimal</code> already has
          directly.</li>
          <li><code>new object[] { accountId, postedAt.Date }</code> is <strong>one array plus
          two boxes</strong>.</li>
          <li><code>string.Join</code> allocates <strong>the result string</strong>, and
          internally a <code>StringBuilder</code> or intermediate buffer.</li>
        </ol>
        <p>That is roughly 8 allocations per call, about 400,000 per second, for a method whose
        actual job is one comparison and one set insertion.</p>
        <p><strong>The rewrite:</strong></p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>// Source-generated logging: no array, no boxing, and the arguments are not
// even evaluated unless Debug is enabled.
[LoggerMessage(
    EventId = 4001,
    Level = LogLevel.Debug,
    Message = "Processing {AccountId} for {Amount} at {PostedAt}")]
private partial void LogProcessing(int accountId, decimal amount, DateTime postedAt);

public bool TryProcess(int accountId, decimal amount, DateTime postedAt)
{
    LogProcessing(accountId, amount, postedAt);

    // decimal has its own CompareTo(decimal). No interface, no box.
    if (amount &lt;= 0m)
    {
        return false;
    }

    // A readonly record struct key: stored inline in the set, compared without
    // reflection, and no string is ever built.
    return _seen.Add(new SeenKey(accountId, postedAt.Date));
}

private readonly record struct SeenKey(int AccountId, DateTime Day);</code></pre>
        <p>The containing class must be declared <code>partial</code> for
        <code>[LoggerMessage]</code>, and <code>_seen</code> becomes a
        <code>HashSet&lt;SeenKey&gt;</code>.</p>
        <p><strong>Allocations on the common path: zero.</strong> The <code>SeenKey</code> is
        stored inline inside the set's internal array, its equality is compiler-generated rather
        than reflective, and the log call boxes nothing.</p>
        <p>The deeper lesson is that none of these allocations were visible in the shape of the
        code. Every one came from a type crossing into a reference-typed API —
        <code>params object[]</code>, an interface variable, an <code>object[]</code>. That
        crossing is what you learn to spot, and it is exactly what the <code>box</code> IL
        instruction marks.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What is copied when you assign one reference-type variable to another?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The reference — the direction to the object — not the object. Both variables then
        refer to the same single instance, so a change made through one is visible through the
        other.</p>
      </div></details>
    </li>
    <li>
      <p>Is "value types live on the stack" true? State the accurate rule.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. A value type is stored <strong>inline, wherever the variable that holds it
        lives</strong>. As a local it is usually on the stack; as a field of a class, an array
        element, a captured lambda variable, or a local held across an <code>await</code>, it is
        on the heap. It may also live only in registers.</p>
      </div></details>
    </li>
    <li>
      <p>What is boxing, what does it cost, and name two places it happens without you asking
      for it.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Boxing wraps a value type in a new heap object so it can be used as a reference. It
        costs one allocation (24 bytes for an <code>int</code> on x64) plus a copy. It happens
        implicitly when assigning to <code>object</code> or an interface variable, in
        <code>params object[]</code> calls such as structured logging, and in non-generic
        collections like <code>ArrayList</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why did calling a mutating method on a <code>readonly</code> struct field silently do
      nothing?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The compiler could not prove the method leaves the value unmodified, so it inserted a
        <strong>defensive copy</strong>, ran the method against the copy, and discarded it.
        Declaring the type <code>readonly struct</code> removes the copies and makes the
        compiler reject any mutating member.</p>
      </div></details>
    </li>
    <li>
      <p>Why is a plain <code>struct</code> containing a <code>string</code> a poor dictionary
      key?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Without an <code>Equals</code>/<code>GetHashCode</code> override it inherits
        <code>ValueType</code>'s implementation. The presence of a reference field rules out the
        fast byte-comparison path, so it compares fields by reflection — measured at about
        <strong>5x slower</strong> in this module. Making it a <code>readonly record
        struct</code>, or implementing <code>IEquatable&lt;T&gt;</code>, fixes it.</p>
      </div></details>
    </li>
    <li>
      <p><code>Money</code> is a struct and <code>Invoice</code> is a class. Give the one-line
      justification for each.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>Money</code> is a <em>value</em>: two amounts with the same figure and currency
        are interchangeable, so it has no identity and should be compared by value.
        <code>Invoice</code> is an <em>entity</em>: it has identity that survives its contents
        changing, so two invoices with identical fields are still two distinct invoices.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>in</code> only safe on a <code>readonly struct</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Because <code>in</code> promises the callee will not modify the argument. If the type
        is not <code>readonly</code>, the compiler cannot prove a member call keeps that promise,
        so it inserts a defensive copy at every member access — potentially many full-struct
        copies where you were trying to avoid one.</p>
      </div></details>
    </li>
  </ol>

  <div class="callout callout--note">
    <h4>Where this leads</h4>
    <p>Everything here is load-bearing for what follows.
    <a href="#/m/t1-15-structs-and-records">Structs, Records, readonly, and init</a> goes deeper
    into the type-declaration side. <a href="#/m/t1-16-equality-and-hashing">Equality,
    GetHashCode, and Comparers</a> takes the hashing contract apart properly.
    <a href="#/m/t2-16-gc-fundamentals">Garbage Collection Fundamentals</a> explains what the
    allocations you have learned to avoid actually cost, and
    <a href="#/m/t2-19-span-and-memory">Span and Memory</a> is where inline storage becomes a
    tool you reach for deliberately.</p>
  </div>
</section>

`
});
