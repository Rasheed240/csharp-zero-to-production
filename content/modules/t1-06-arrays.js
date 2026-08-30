/* ============================================================================
   Track 1, Module 6 — Arrays
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-06-arrays/.
   ========================================================================= */

CSPREP.module({
  id: "t1-06-arrays",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "An array is a fixed-length run of elements laid out end to end in memory. That single " +
    "design decision explains its speed, its inability to grow, why the order you walk a grid " +
    "changes the time by several times, and why a 21,244-element array is collected differently " +
    "from a 21,243-element one.",
  terms: [
    "array", "element", "index", "length", "contiguous", "zero-initialisation",
    "bounds check", "IndexOutOfRangeException", "CPU cache", "cache line",
    "spatial locality", "row-major", "rectangular array", "jagged array",
    "array covariance", "Large Object Heap", "generation", "amortised"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Three reports reach the same team in a fortnight.</p>

  <p>A reporting endpoint returns in 200 milliseconds for every customer except one, where it
  takes eleven seconds. The slow customer's data is about four times larger than the next
  biggest. Four times the data, fifty-five times the time. The code is a pair of nested loops
  over a grid, and it looks entirely reasonable.</p>

  <p>A long-running import service creeps upward in memory over a day and triggers full garbage
  collections far more often than its allocation rate suggests it should. The objects it holds
  are not leaking — memory usage returns to normal after a restart and climbs again. The team
  has been told the .NET garbage collector handles this automatically, and it does, but
  something is defeating it.</p>

  <p>A line of code that has compiled and run for two years throws
  <code>ArrayTypeMismatchException</code> in production. Nobody has heard of it. The compiler
  raised no warning, and the same line still compiles today.</p>

  <p>All three come from the same place: <strong>what an array physically is</strong>. It is the
  simplest data structure in the language — a fixed-length run of elements laid end to end — and
  almost everything surprising about it follows from those two properties, <em>fixed length</em>
  and <em>laid end to end</em>.</p>

  <p>This module is short on syntax, because there is little, and long on consequences, because
  there are many.</p>
</section>

<section id="what-an-array-is">
  <h2>What an array actually is</h2>

  <p>Every term is defined before it is used again.</p>

  <p class="define"><span class="define__term">Memory</span> The working space a program uses
  while running: a very long row of numbered slots, each holding one byte. A slot's number is
  its address.</p>

  <p class="define"><span class="define__term">Array</span> A fixed number of values of the same
  type, stored one after another in a single unbroken run of memory.</p>

  <p class="define"><span class="define__term">Element</span> One of those values.</p>

  <p class="define"><span class="define__term">Index</span> An element's position, counting from
  <strong>zero</strong>. The first element is at index 0, and an array of length 3 has indexes 0,
  1, and 2.</p>

  <p class="define"><span class="define__term">Length</span> How many elements the array holds.
  Fixed when the array is created and never changes.</p>

  <p class="define"><span class="define__term">Contiguous</span> Occupying one unbroken run of
  memory with nothing in between. This is the property that makes arrays fast, and it is the
  reason they cannot grow.</p>

  <p>Contiguity buys one enormous thing: <strong>finding element <em>n</em> requires no
  searching</strong>. The runtime knows where the array starts and how many bytes each element
  takes, so the address of element <em>n</em> is one multiplication and one addition. That is why
  reading <code>array[900_000]</code> costs the same as reading <code>array[0]</code>.</p>

  <div class="callout callout--note">
    <h4>The analogy, and where it breaks</h4>
    <p>An array is a <strong>row of numbered lockers in a corridor</strong>, all the same size,
    with no gaps. Locker 500 needs no searching: walk 500 locker-widths from the start. And
    because they are the same size, that arithmetic always works.</p>
    <p>Where the analogy breaks, and it is the whole module: you cannot add a locker to the end
    of the row, because something else has already been built there. Adding one means finding a
    longer stretch of corridor, building a whole new row, and carrying everything across. That is
    exactly what <code>Array.Resize</code> does, and the section on growth measures what it
    costs.</p>
    <p>The analogy also understates the speed benefit. Real memory is not uniformly fast: reading
    locker 501 right after locker 500 is dramatically cheaper than reading a locker far away,
    for reasons the memory-layout section measures.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>Creating and using one</h2>

<pre data-lang="csharp" data-net="10" data-title="01-array-basics.cs"><code>int[] a = new int[3] { 10, 20, 30 };
int[] b = new int[] { 10, 20, 30 };
int[] c = { 10, 20, 30 };
int[] d = [10, 20, 30];              // collection expression, C# 12+

Console.WriteLine($"{string.Join(",", a)} | {string.Join(",", b)} | {string.Join(",", c)} | {string.Join(",", d)}");</code></pre>

<pre data-lang="console" data-title="Output"><code>10,20,30 | 10,20,30 | 10,20,30 | 10,20,30</code></pre>

  <p>All four are the same array. The last form, <code>[10, 20, 30]</code>, is a collection
  expression and is the modern default.</p>

  <p class="define"><span class="define__term">Zero-initialisation</span> Every element of a new
  array is set to its type's default — 0 for numbers, <code>false</code> for <code>bool</code>,
  <code>null</code> for reference types. The runtime guarantees this.</p>

<pre data-lang="csharp" data-net="10" data-title="01-array-basics.cs"><code>int[] numbers = new int[4];
string?[] names = new string?[3];
bool[] flags = new bool[2];

Console.WriteLine($"new int[4]     -&gt; {string.Join(",", numbers)}");
Console.WriteLine($"new string?[3] -&gt; {string.Join(",", names.Select(n =&gt; n is null ? "null" : n))}");
Console.WriteLine($"new bool[2]    -&gt; {string.Join(",", flags)}");</code></pre>

<pre data-lang="console" data-title="Output"><code>new int[4]     -&gt; 0,0,0,0
new string?[3] -&gt; null,null,null
new bool[2]    -&gt; False,False</code></pre>

  <p>This is a genuine safety guarantee — in C you would get whatever the previous occupant of
  that memory left behind — but it is not free. Allocating a 10-million-element
  <code>int[]</code> means writing 40 MB of zeros before your code touches it.</p>

  <h3>An array variable holds a reference</h3>

  <p>The array itself lives on the heap. The variable holds a direction to it, so copying the
  variable does not copy the elements.</p>

<pre data-lang="csharp" data-net="10" data-title="01-array-basics.cs"><code>int[] original = { 1, 2, 3 };
int[] alias = original;             // copies the reference, not the elements
alias[0] = 99;
Console.WriteLine($"original[0] after alias[0] = 99  -&gt; {original[0]}");
Console.WriteLine($"ReferenceEquals(original, alias) -&gt; {ReferenceEquals(original, alias)}");

int[] copy = (int[])original.Clone();
copy[0] = 7;
Console.WriteLine($"original[0] after copy[0] = 7    -&gt; {original[0]}");

int[] left = { 1, 2, 3 };
int[] right = { 1, 2, 3 };
Console.WriteLine($"left == right                    -&gt; {left == right}");
Console.WriteLine($"left.SequenceEqual(right)        -&gt; {left.SequenceEqual(right)}");</code></pre>

<pre data-lang="console" data-title="Output"><code>original[0] after alias[0] = 99  -&gt; 99
ReferenceEquals(original, alias) -&gt; True
original[0] after copy[0] = 7    -&gt; 99   (Clone made a real copy)
left == right                    -&gt; False
left.SequenceEqual(right)        -&gt; True</code></pre>

  <p><code>==</code> on two arrays compares <em>references</em>, so two arrays with identical
  contents are not equal. Use <code>SequenceEqual</code> for contents. The memory model behind
  this is covered in <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a>.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha: <code>Array.Empty&lt;T&gt;()</code> is not the same as <code>new T[0]</code></h4>
<pre data-lang="console" data-title="Output"><code>ReferenceEquals(Array.Empty, Array.Empty) -&gt; True
ReferenceEquals(Array.Empty, new int[0])  -&gt; False</code></pre>
    <p><code>Array.Empty&lt;T&gt;()</code> returns one shared, cached instance; <code>new
    int[0]</code> allocates a fresh object every time. Since an empty array has no elements to
    tell apart, there is never a reason to allocate one. Return <code>Array.Empty&lt;T&gt;()</code>
    from a method with nothing to give back, and never <code>null</code> — a caller that has to
    null-check every result is a caller that will eventually forget.</p>
  </div>
</section>

<section id="bounds-checking">
  <h2>Bounds checking</h2>

  <p class="define"><span class="define__term">Bounds check</span> A comparison the runtime
  performs on every array access, confirming the index is within the array, before reading or
  writing.</p>

  <p class="define"><span class="define__term">IndexOutOfRangeException</span> The exception
  thrown when it is not.</p>

  <p>This is a memory-safety guarantee, not a convenience. Without it, reading
  <code>array[5]</code> on a 3-element array would read whatever bytes happen to sit after the
  array — another object's data, or something the program has no business seeing. That is the
  root of a large fraction of security vulnerabilities in languages that omit the check.</p>

<pre data-lang="csharp" data-net="10" data-title="02-bounds-checking.cs"><code>int[] small = { 10, 20, 30 };

try
{
    Console.WriteLine(small[3]);
}
catch (IndexOutOfRangeException ex)
{
    Console.WriteLine($"small[3] -&gt; {ex.GetType().Name}: {ex.Message}");
}

Console.WriteLine($"small[^1] (last element) -&gt; {small[^1]}");</code></pre>

<pre data-lang="console" data-title="Output"><code>small[3] -&gt; IndexOutOfRangeException: Index was outside the bounds of the array.
small[negative] -&gt; IndexOutOfRangeException: Index was outside the bounds of the array.
small[^1] (last element) -&gt; 30
small[^4] -&gt; IndexOutOfRangeException</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: the message tells you nothing useful</h4>
    <p>"Index was outside the bounds of the array" omits the index that was attempted, the
    length of the array, and which array it was. In a method with several arrays and a stack
    trace pointing at one line, that can leave you guessing.</p>
    <p>When an index comes from outside your method, validate it yourself and throw something
    informative:</p>
<pre data-lang="csharp" data-net="10"><code>if (index &lt; 0 || index &gt;= buffer.Length)
{
    throw new ArgumentOutOfRangeException(
        nameof(index), index, $"Index must be between 0 and {buffer.Length - 1}.");
}</code></pre>
    <p><code>ArgumentOutOfRangeException.ThrowIfNegative</code> and
    <code>ThrowIfGreaterThanOrEqual</code> do the same in one line each, and include the value
    and parameter name automatically.</p>
  </div>

  <h3>What the check costs</h3>

  <p>Widely repeated advice says you must write <code>for (int i = 0; i &lt; array.Length; i++)</code>
  — comparing against <code>array.Length</code> specifically — so the JIT compiler can prove the
  index is safe and skip the check. So: measure it. A 4,096-element array that fits in cache,
  iterated 200,000 times, so per-element overhead dominates rather than memory speed.</p>

<pre data-lang="console" data-title="dotnet run -c Release 02-bounds-checking.cs"><code>4,096 ints, iterated 200,000 times, three rounds:
  round 1:  i &lt; array.Length   561 ms     i &lt; length   573 ms     ratio 1.02x
  round 2:  i &lt; array.Length   525 ms     i &lt; length   525 ms     ratio 1.00x
  round 3:  i &lt; array.Length   538 ms     i &lt; length   558 ms     ratio 1.04x</code></pre>

  <p><strong>There is no measurable difference.</strong> On .NET 10 the JIT handles both forms,
  and whatever check remains costs less than the run-to-run noise.</p>

  <p>The honest conclusion is not "bounds checks are free" — they are real instructions and in
  tight numeric kernels they can matter. It is that <strong>this particular piece of folklore no
  longer buys anything</strong>, and writing an awkward loop to chase it is wasted effort. Write
  whichever form is clearer. If you genuinely need to eliminate checks in a hot numeric loop, the
  tool is <code>Span&lt;T&gt;</code>, covered in
  <a href="#/m/t2-19-span-and-memory">Span and Memory</a>, not loop-shape trickery.</p>
</section>

<section id="memory-layout">
  <h2>Why the order you walk an array matters</h2>

  <p>This section is the one that explains the eleven-second report, and it is the strongest
  practical reason to understand what an array physically is.</p>

  <p class="define"><span class="define__term">CPU cache</span> A small, extremely fast memory
  attached to the processor. Main memory is roughly a hundred times slower to reach, so the
  processor keeps recently used data in cache and hopes to find what it needs there.</p>

  <p class="define"><span class="define__term">Cache line</span> The unit the processor moves
  between memory and cache — typically <strong>64 bytes</strong>. Asking for one
  <code>int</code> fetches the 64-byte block containing it, which is 16 <code>int</code>s.</p>

  <p class="define"><span class="define__term">Spatial locality</span> The tendency of a program
  to use data near what it used a moment ago. Hardware is built assuming this, and rewards it
  heavily.</p>

  <p>So walking an array forwards is close to free after the first element of each block: one
  fetch serves the next fifteen <code>int</code>s. Jumping around defeats it — every access pays
  a full trip to main memory, and 60 of the 64 bytes fetched are discarded.</p>

  <p>Here is the effect, on one 2,000 × 2,000 grid of integers, summed in two different orders:</p>

<pre data-lang="csharp" data-net="10" data-title="03-cache-locality.cs"><code>// C# lays a rectangular array out row by row, so this walks memory in order.
static long SumRowMajor(int[,] grid)
{
    long total = 0;
    int rows = grid.GetLength(0);
    int columns = grid.GetLength(1);

    for (int row = 0; row &lt; rows; row++)
    {
        for (int column = 0; column &lt; columns; column++)
        {
            total += grid[row, column];
        }
    }
    return total;
}

// Same elements, but each step jumps a whole row's width through memory.
static long SumColumnMajor(int[,] grid)
{
    long total = 0;
    int rows = grid.GetLength(0);
    int columns = grid.GetLength(1);

    for (int column = 0; column &lt; columns; column++)
    {
        for (int row = 0; row &lt; rows; row++)
        {
            total += grid[row, column];
        }
    }
    return total;
}</code></pre>

<pre data-lang="console" data-title="dotnet run -c Release 03-cache-locality.cs"><code>2000 x 2000 int grid (15 MB), summed 5 times

  row-major    (i outer, j inner) :     21 ms
  column-major (j outer, i inner) :    112 ms
  ratio                           :    5.3x</code></pre>

  <p><strong>Identical arithmetic, identical element count, four million additions either
  way.</strong> Across three runs the ratio was 5.3x, 5.7x, and 3.1x — the magnitude moves with
  machine load, the direction never does.</p>

  <p class="define"><span class="define__term">Row-major</span> Laying a grid out one complete
  row after another. C#, C, and C++ all do this. Fortran and MATLAB are column-major, which is
  why porting numeric code between them without swapping the loops produces exactly this
  slowdown.</p>

  <p>The rule that follows is short and worth memorising: <strong>the last index should change
  fastest</strong>. In a nested loop over a grid, the inner loop varies the column.</p>

  <div class="callout callout--note">
    <h4>Where this bites in ordinary code</h4>
    <p>You may not write grid maths. The same effect appears whenever you walk data in an order
    that does not match its layout, and the usual culprits do not look like grids:</p>
    <ul>
      <li>Iterating a list of objects and touching one field of each. The objects are scattered
      on the heap, so each is a separate fetch. An array of a small <code>struct</code> puts the
      fields end to end instead — the reason this matters is in
      <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a>.</li>
      <li>Processing a table column-by-column when it is stored row-by-row.</li>
      <li>Following a linked structure, where every step is a jump to somewhere unrelated.</li>
    </ul>
    <p>This is also why "the same algorithm" can be several times slower in one data structure
    than another with identical complexity. Big-O counts operations; it says nothing about how
    far apart they are in memory.</p>
  </div>
</section>

<section id="two-dimensions">
  <h2>Two dimensions: rectangular, jagged, or flat</h2>

  <p>C# offers two built-in ways to express a grid, and there is a third worth knowing.</p>

  <p class="define"><span class="define__term">Rectangular array</span> Written
  <code>int[,]</code>. One object holding every element, with all rows the same length.</p>

  <p class="define"><span class="define__term">Jagged array</span> Written
  <code>int[][]</code>. An array whose elements are themselves arrays, so rows may differ in
  length — and each row is a separate object on the heap.</p>

<pre data-lang="csharp" data-net="10" data-title="04-jagged-vs-multidim.cs"><code>// (a) rectangular: one object, one allocation
int[,] rectangular = new int[Size, Size];

// (b) jagged: an array of arrays. 2,001 separate objects.
int[][] jagged = new int[Size][];
for (int row = 0; row &lt; Size; row++)
{
    jagged[row] = new int[Size];
}

// (c) flat: one 1-D array, indexed by hand
int[] flat = new int[Size * Size];

// and the index arithmetic the other two forms do for you:
flat[(row * Size) + column] = value;</code></pre>

  <p>Summing all four million elements row-major in each, five times over:</p>

<pre data-lang="console" data-title="dotnet run -c Release 04-jagged-vs-multidim.cs"><code>2000 x 2000 grid, summed 5 times, all row-major:

  rectangular int[,]   :    22 ms   1 object
  jagged      int[][]  :    16 ms   2,001 objects
  flat        int[]    :    11 ms   1 object

  rectangular / flat   : 2.0x
  jagged / flat        : 1.5x</code></pre>

  <p>That ordering surprises most people, so it is worth stating plainly: <strong>the
  rectangular array — the one that is a single contiguous block — is the slowest of the
  three.</strong> Across three runs the rectangular array measured 1.9x to 2.0x the flat
  array, and the jagged array 1.2x to 1.5x. The ordering never changed.</p>

  <p>The reason is that <code>int[,]</code> is a distinct runtime type with its own indexing
  machinery. Each access multiplies by the row length and adds, and the JIT optimises those
  accesses far less aggressively than it optimises single-dimension arrays, which it has been
  tuned for since .NET 1.0. The jagged version's inner loop is over a plain
  <code>int[]</code>, which gets the good treatment; its cost is one extra indirection per row
  and 2,001 objects for the collector to trace.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th></th><th>Rectangular <code>int[,]</code></th><th>Jagged <code>int[][]</code></th><th>Flat <code>int[]</code></th></tr></thead>
      <tbody>
        <tr><td>Objects allocated</td><td>1</td><td>rows + 1</td><td>1</td></tr>
        <tr><td>Rows may differ in length</td><td>No</td><td>Yes</td><td>No</td></tr>
        <tr><td>Measured relative cost</td><td>1.9x&ndash;2.0x</td><td>1.2x&ndash;1.5x</td><td>1.0x</td></tr>
        <tr><td>Readability</td><td>Best — <code>grid[r, c]</code></td><td>Good — <code>grid[r][c]</code></td><td>Worst — manual arithmetic</td></tr>
        <tr><td>Works with <code>Span&lt;T&gt;</code></td><td>No</td><td>Per row</td><td>Yes</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>What to do with this.</strong> Use <code>int[,]</code> when the grid is small or
  cold and clarity wins — a 2x difference on a 100-element grid is nothing. Use a flat array with
  computed indexing when the grid is large and hot, and hide the arithmetic behind an indexer so
  the call sites stay readable. Reach for jagged when rows genuinely differ in length, which is
  the case it exists for.</p>
</section>

<section id="growing">
  <h2>Arrays do not grow</h2>

  <p>The length is fixed at creation. <code>Array.Resize</code> looks like it changes that, and
  does not:</p>

<pre data-lang="csharp" data-net="10" data-title="07-resize-and-copy.cs"><code>int[] original = { 1, 2, 3 };
int[] alias = original;

Array.Resize(ref original, 5);

Console.WriteLine($"original.Length  : {original.Length}");
Console.WriteLine($"alias.Length     : {alias.Length}");
Console.WriteLine($"same object?     : {ReferenceEquals(original, alias)}");
Console.WriteLine($"original contents: {string.Join(",", original)}");</code></pre>

<pre data-lang="console" data-title="Output"><code>original.Length  : 5
alias.Length     : 3   &lt;-- the old array, untouched
same object?     : False
original contents: 1,2,3,0,0</code></pre>

  <p>It allocated a new array, copied every element across, and reassigned the <code>ref</code>
  parameter. The original array still exists, unchanged, for anyone else holding a reference to
  it. That is why the parameter is <code>ref</code> — the method has to replace the caller's
  variable, because it cannot change the array.</p>

  <p>Doing that once is fine. Doing it per element is quadratic:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="07-resize-and-copy.cs"><code>int[] grown = Array.Empty&lt;int&gt;();
for (int i = 0; i &lt; count; i++)
{
    Array.Resize(ref grown, grown.Length + 1);   // allocates and copies EVERY time
    grown[i] = i;
}</code></pre>

<pre data-lang="console" data-title="dotnet run -c Release 07-resize-and-copy.cs"><code>   items   Array.Resize    List&lt;T&gt;.Add
----------------------------------------
  10,000          17 ms           0 ms
  20,000          73 ms           0 ms
  40,000         319 ms           0 ms
  80,000       2,011 ms           0 ms</code></pre>

  <p>Each doubling of the count roughly quadruples the time — the signature of quadratic work,
  covered in <a href="#/m/t1-04-control-flow">Control Flow</a>. <code>List&lt;T&gt;</code> stays
  at zero milliseconds throughout.</p>

  <p class="define"><span class="define__term">Amortised</span> Averaged over many operations.
  <code>List&lt;T&gt;.Add</code> is occasionally expensive — when it grows — but the expensive
  cases are rare enough that the average is constant.</p>

  <p><code>List&lt;T&gt;</code> is an array underneath. What it adds is a growth policy: when
  full, allocate a buffer <strong>twice</strong> the size and copy. Doubling means the copying
  work halves each time, so the total across <em>n</em> additions is proportional to
  <em>n</em>, not <em>n</em>².</p>

<pre data-lang="console" data-title="Observed capacity growth"><code>count   1 -&gt; capacity   4
count   5 -&gt; capacity   8
count   9 -&gt; capacity  16
count  17 -&gt; capacity  32
count  33 -&gt; capacity  64</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha: tell the constructor the size when you know it</h4>
    <p>Each of those steps is an allocation plus a copy. Adding 100,000 items to a
    <code>new List&lt;int&gt;()</code> performs about 16 reallocations and copies roughly 200,000
    elements in total, all of it avoidable:</p>
<pre data-lang="csharp" data-net="10"><code>List&lt;Invoice&gt; results = new List&lt;Invoice&gt;(expectedCount);   // one allocation, no copying</code></pre>
    <p>The same applies to <code>Dictionary</code>, <code>HashSet</code>, and
    <code>StringBuilder</code>. When the count is known or closely estimable, passing it is free
    and removes the entire growth sequence.</p>
  </div>

  <p>For copying an array you already have, prefer the framework's bulk operations. Copying one
  million integers:</p>

<pre data-lang="console" data-title="Output"><code>element-by-element loop  :    4 ms
Array.Copy               :    0 ms
Clone (allocates too)    :    1 ms</code></pre>

  <p><code>Array.Copy</code> hands the work to a highly optimised block move rather than looping
  in your code. For anything larger than a handful of elements it is the right choice.</p>
</section>

<section id="the-loh">
  <h2>The size at which an array is treated differently</h2>

  <p>This is the second incident from the opening.</p>

  <p class="define"><span class="define__term">Generation</span> The garbage collector sorts
  objects by age. New objects start in generation 0, which is collected often and cheaply.
  Survivors are promoted to generation 1, then generation 2, which is collected rarely and
  expensively.</p>

  <p class="define"><span class="define__term">Large Object Heap (LOH)</span> A separate area for
  objects of <strong>85,000 bytes or more</strong>. It is reported as generation 2, is collected
  only during expensive full collections, and by default is <em>not compacted</em>, so it
  fragments.</p>

  <p>The threshold is about the object's size in bytes, not its element count — which means the
  element count where it bites depends on the element type. Measured by asking the collector
  which generation each array landed in:</p>

<pre data-lang="console" data-title="dotnet run -c Release 06-large-object-heap.cs"><code>element type   bytes each     LOH from   elements
--------------------------------------------------
byte                    1     85,000 B     84,976
int                     4     85,000 B     21,244
long                    8     85,000 B     10,622
double                  8     85,000 B     10,622

measured, by searching for the first length reported as generation 2:
  first int[]    on the LOH:  21,244 elements  ( 84,976 bytes payload)
  first string[] on the LOH:  10,622 elements  ( 84,976 bytes payload)

  new int[21,000]    84,024 bytes total  -&gt; generation 0
  new int[21,243]    84,996 bytes total  -&gt; generation 0
  new int[21,244]    85,000 bytes total  -&gt; generation 2
  new int[30,000]   120,024 bytes total  -&gt; generation 2</code></pre>

  <p>An <code>int[21,243]</code> is an ordinary short-lived object. An <code>int[21,244]</code> —
  one element larger — goes on the Large Object Heap and stays until a full collection. The
  boundary is exact: 84,976 bytes of elements plus the 24-byte array header (a 16-byte object
  header and an 8-byte length) is precisely 85,000.</p>

  <p><strong>21,244 is not a large number.</strong> A buffer for a 20,000-row report, a batch of
  10,000 records with two fields each, an 11,000-element <code>string[]</code> — all of these
  cross it without feeling large.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The failure mode is not a single big array; it is <strong>repeatedly allocating
    medium-large arrays</strong>. Each goes to the LOH, which is not compacted, so the free space
    left behind is a patchwork of gaps. A later allocation that does not fit any single gap
    forces the heap to grow even though plenty of total memory is free.</p>
    <p>The symptom is the one in the opening: memory climbing over hours, frequent generation-2
    collections, and no leak — the objects really are being collected. The cause is fragmentation
    plus the expense of full collections.</p>
    <p>The fix is to stop allocating them: rent a reusable buffer from
    <code>ArrayPool&lt;T&gt;.Shared</code>, or process in chunks that stay under the threshold.
    Both are covered in <a href="#/m/t2-20-zero-allocation">Zero-Allocation Techniques</a>.
    <code>GCSettings.LargeObjectHeapCompactionMode</code> can compact it on demand, but that is a
    full blocking collection and a last resort.</p>
  </div>
</section>

<section id="covariance">
  <h2>Array covariance: a hole the language cannot close</h2>

  <p>This is the third incident, and it is the one piece of array behaviour that is purely a
  historical mistake.</p>

  <p class="define"><span class="define__term">Array covariance</span> The rule that a
  <code>string[]</code> may be used where an <code>object[]</code> is expected, because
  <code>string</code> derives from <code>object</code>.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="05-covariance.cs"><code>string[] references = { "INV-1", "INV-2", "INV-3" };

// This assignment compiles. A string[] is treated as an object[].
object[] asObjects = references;

// Reading is safe. Writing a string is safe.
asObjects[0] = "INV-99";

// Writing an int compiles, then throws.
asObjects[1] = 42;</code></pre>

<pre data-lang="console" data-title="Output"><code>actual runtime type           : String[]
asObjects[0] = "INV-99"       -&gt; INV-99

writing an int compiles, then throws:
  threw ArrayTypeMismatchException
  message: Attempted to access an element as a type incompatible with the array.</code></pre>

  <p>The array is still a <code>string[]</code> at run time. The compiler let you view it through
  an <code>object[]</code> variable, which promises you can store any object in it — a promise
  the array cannot keep.</p>

  <p>This dates from C# 1.0 in 2002, before generics existed, when it was the only way to write a
  method that sorted any array. It cannot be removed now without breaking a great deal of code.
  It has two costs:</p>

  <ul>
    <li><strong>A type error deferred from compile time to run time,</strong> in a language whose
    whole selling point is catching those early.</li>
    <li><strong>A run-time type check on every store into a reference-type array,</strong>
    because the runtime cannot know statically whether the array is really of the element type
    the variable claims.</li>
  </ul>

  <p>The generic collections learned from it:</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Does not compile, and that is the point"><code>List&lt;string&gt; names = new List&lt;string&gt;();
List&lt;object&gt; objects = names;   // CS0029: cannot convert</code></pre>

  <p><code>List&lt;T&gt;</code> is invariant, so this is caught at build time.
  <code>IEnumerable&lt;out T&gt;</code> <em>is</em> covariant, and safely so, because it is
  read-only — there is no way to store the wrong thing through it:</p>

<pre data-lang="csharp" data-net="10" data-title="Safe covariance"><code>IEnumerable&lt;object&gt; readOnly = references;   // fine, and cannot throw</code></pre>

  <p>The practical rule: <strong>never expose a mutable array through a base-typed variable or
  parameter.</strong> If a method takes <code>object[]</code>, it is asking for this bug. Take
  <code>IReadOnlyList&lt;T&gt;</code> or a concrete type instead.</p>
</section>

<section id="production-example">
  <h2>The same ideas in a real service</h2>

  <p>Ledger builds a daily settlement matrix: for each of several thousand merchant accounts, a
  running total per day of the month. It is written and read hot, so it uses a flat array with
  computed indexing, hidden behind an indexer so call sites stay readable.</p>

<pre data-lang="csharp" data-net="10" data-title="Ledger — SettlementMatrix.cs"><code>using System.Globalization;

/// &lt;summary&gt;
/// A dense accounts-by-days grid of settled amounts, stored as one flat array.
/// &lt;/summary&gt;
public sealed class SettlementMatrix
{
    private readonly decimal[] _cells;
    private readonly int _dayCount;

    public SettlementMatrix(int accountCount, int dayCount)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(accountCount);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(dayCount);

        AccountCount = accountCount;
        _dayCount = dayCount;

        // One allocation, zeroed by the runtime. Note the size check below:
        // 3,000 accounts x 31 days x 16 bytes is 1.5 MB, well onto the LOH,
        // which is fine for a long-lived object but must be deliberate.
        _cells = new decimal[accountCount * dayCount];
    }

    public int AccountCount { get; }

    public int DayCount =&gt; _dayCount;

    /// &lt;summary&gt;
    /// Row-major indexing: the day index changes fastest, so walking a whole
    /// account's month reads consecutive memory.
    /// &lt;/summary&gt;
    public decimal this[int accountIndex, int dayIndex]
    {
        get =&gt; _cells[Offset(accountIndex, dayIndex)];
        set =&gt; _cells[Offset(accountIndex, dayIndex)] = value;
    }

    public decimal TotalForAccount(int accountIndex)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(accountIndex);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(accountIndex, AccountCount);

        int start = accountIndex * _dayCount;
        decimal total = 0m;

        // Contiguous: one cache line serves several cells.
        for (int day = 0; day &lt; _dayCount; day++)
        {
            total += _cells[start + day];
        }
        return total;
    }

    /// &lt;summary&gt;
    /// Deliberately structured so the INNER loop varies the day, matching the
    /// layout. Swapping these two loops measured several times slower.
    /// &lt;/summary&gt;
    public decimal GrandTotal()
    {
        decimal total = 0m;
        for (int account = 0; account &lt; AccountCount; account++)
        {
            int start = account * _dayCount;
            for (int day = 0; day &lt; _dayCount; day++)
            {
                total += _cells[start + day];
            }
        }
        return total;
    }

    private int Offset(int accountIndex, int dayIndex)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(accountIndex);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(accountIndex, AccountCount);
        ArgumentOutOfRangeException.ThrowIfNegative(dayIndex);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(dayIndex, _dayCount);

        return (accountIndex * _dayCount) + dayIndex;
    }
}</code></pre>

  <p>Five decisions there, each of which this module explains:</p>

  <ul>
    <li><strong>A flat array rather than <code>decimal[,]</code>,</strong> measured at about half
    the access cost, with the arithmetic hidden behind an indexer so callers still write
    <code>matrix[account, day]</code>.</li>
    <li><strong>Row-major by account,</strong> so the common operation — one account's whole
    month — reads consecutive memory.</li>
    <li><strong>Both loops in <code>GrandTotal</code> ordered to match the layout,</strong> with
    a comment saying why, because the fast and slow versions look equally reasonable.</li>
    <li><strong>Explicit bounds validation in <code>Offset</code>,</strong> because computed
    indexing can produce an in-range offset from two out-of-range inputs — an account index one
    too large with a small day index lands inside the next account's row and silently corrupts
    it. The array's own bounds check would not catch that.</li>
    <li><strong>The LOH size noted in a comment,</strong> because 1.5 MB is well past the 85,000
    byte threshold. That is acceptable for an object that lives for the whole batch; it would not
    be for one allocated per request.</li>
  </ul>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Walking a grid against its layout</h3>

  <p>Measured above at 3.1x to 5.7x. The two loops look identical in review, and the slow one is
  a natural thing to write when you are thinking "for each column".</p>

  <h3>2. Growing an array in a loop</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>Array.Resize(ref buffer, buffer.Length + 1);</code></pre>

  <p>Quadratic — 2,011 ms for 80,000 items against 0 ms for <code>List&lt;T&gt;</code>. If you are
  calling <code>Array.Resize</code> inside a loop, you want a <code>List&lt;T&gt;</code>.</p>

  <h3>3. Medium-large arrays allocated repeatedly</h3>

  <p>Anything from 21,244 <code>int</code>s or 10,622 references upward goes to the Large Object
  Heap. Per-request buffers of that size fragment the heap and force expensive full
  collections.</p>

  <h3>4. Handing out your internal array</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>public class Batch
{
    private readonly string[] _references = new string[100];

    // The caller can now write to your internal state.
    public string[] References =&gt; _references;
}</code></pre>

  <p>There is no read-only array. Returning one gives every caller full write access to your
  object's internals, and <code>readonly</code> on the field prevents only <em>replacing</em> the
  array, not modifying its contents. Return <code>IReadOnlyList&lt;string&gt;</code>, a copy, or a
  <code>ReadOnlySpan&lt;string&gt;</code>.</p>

  <h3>5. <code>BinarySearch</code> on unsorted data</h3>

<pre data-lang="console" data-title="Output"><code>BinarySearch(sorted, 30)   -&gt; 2    (index)
BinarySearch(sorted, 35)   -&gt; -4   (~ of the insertion point)
BinarySearch(unsorted, 30) -&gt; -1   &lt;-- wrong, and no error</code></pre>

  <p>Binary search assumes order and cannot verify it without defeating its own purpose. On
  unsorted input it returns a wrong answer silently. Note also that a <em>negative</em> return is
  not merely "not found": it is the bitwise complement of where the value would be inserted, so
  <code>~result</code> gives the insertion point.</p>

  <h3>6. Covariance</h3>

  <p><code>ArrayTypeMismatchException</code> at run time from a line that compiles. Covered
  above.</p>

  <h3>7. Off-by-one</h3>

<pre data-lang="csharp" data-net="10" data-bad="true"><code>for (int i = 0; i &lt;= items.Length; i++)   // IndexOutOfRangeException on the last pass</code></pre>

  <p>An array of length 3 has indexes 0, 1, 2. <code>i &lt; length</code> is correct;
  <code>&lt;=</code> is a signal to check the bounds deliberately.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>Symptom: fine for most customers, far too slow for one</h4>
    <ol>
      <li><strong>Compare the data sizes first.</strong> If the slow customer has 4x the data and
      takes 55x the time, the code is worse than linear and no amount of profiling the fast case
      will show it.</li>
      <li><strong>Time it at n and 2n.</strong> Roughly 2x is linear. Roughly 4x is quadratic —
      look for a nested loop, as in <a href="#/m/t1-04-control-flow">Control Flow</a>. Between
      2x and 4x with a big constant, suspect memory access order.</li>
      <li><strong>Check the loop order against the layout.</strong> For any nested loop over a
      grid, ask which index changes fastest. If it is not the last one, swap the loops and
      measure again — measured here at 3.1x to 5.7x for that change alone.</li>
      <li><strong>Confirm it is memory and not arithmetic</strong> by shrinking the data until it
      fits in cache. If the ratio collapses at small sizes and reappears at large ones, it is
      cache behaviour.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: memory climbing, frequent gen-2 collections, no leak</h4>
    <ol>
      <li><strong>Watch the generation counters</strong> against the live process:
<pre data-lang="bash" data-title="terminal"><code>dotnet-counters monitor --process-id 1234 --counters System.Runtime</code></pre>
      A high <code>gen-2-gc-count</code> relative to <code>gen-0-gc-count</code>, plus a
      <code>loh-size</code> that grows and does not fall back, is the signature.</li>
      <li><strong>Take a heap snapshot and sort by size:</strong>
<pre data-lang="bash" data-title="terminal"><code>dotnet-gcdump collect --process-id 1234</code></pre>
      Look for many arrays in the tens of kilobytes. Anything at or above 85,000 bytes is on the
      LOH by definition.</li>
      <li><strong>Work out the element count that crosses the line</strong> for your element
      type: 85,000 minus the 24-byte header, divided by the element size. For <code>int</code>
      that is 21,244; for a reference type on 64-bit, 10,622.</li>
      <li><strong>Fix by not allocating them repeatedly</strong> — pool the buffers with
      <code>ArrayPool&lt;T&gt;.Shared</code>, or process in chunks below the threshold. Sizing a
      per-request buffer at 16,000 rather than 32,000 elements can move it off the LOH
      entirely.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: <code>IndexOutOfRangeException</code> with an unhelpful message</h4>
    <ol>
      <li><strong>The message never names the index or the array.</strong> Do not expect it to;
      go to the line in the stack trace and identify which access it is.</li>
      <li><strong>Check for computed indexing.</strong> <code>array[(row * width) + column]</code>
      can be in range while <code>row</code> and <code>column</code> are individually wrong,
      which corrupts data silently instead of throwing. Validate the inputs, not the offset.</li>
      <li><strong>Check the loop bound</strong> for <code>&lt;=</code> where <code>&lt;</code>
      was meant, and for a length captured before the collection changed size.</li>
      <li><strong>Fix by validating at the boundary</strong> with
      <code>ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual</code>, which reports the value
      and the parameter name, rather than letting the array throw a message with neither.</li>
    </ol>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's month-end statement job builds a settlement matrix of accounts by days and
    totals it. It was written when the platform had about 800 merchant accounts, ran in under a
    second, and nobody looked at it again.</p>
    <p>Two years later, at 3,200 accounts, it took eleven seconds and was close to the job
    runner's timeout. Two things had gone wrong at once, and they compounded.</p>
    <p><strong>First, the loop order.</strong> The grid was stored row-major by account, and the
    totalling loop iterated day-outer, account-inner — natural to write when the requirement
    reads "for each day, total every account". Measured on an equivalent 2,000 × 2,000 grid, that
    order cost <strong>112 ms against 21 ms</strong>, a factor of 5.3 (and 5.7x and 3.1x on
    repeat runs). Every one of those four million reads fetched a 64-byte cache line to use
    4 bytes of it.</p>
    <p><strong>Second, the buffer size crossed a threshold.</strong> At 800 accounts × 31 days ×
    16 bytes per <code>decimal</code>, the matrix was about 397 KB — already on the Large Object
    Heap, but allocated once per run and therefore harmless. When a change split the job into
    per-region batches, it began allocating a fresh matrix per region, forty times a run. Each
    went to the LOH, which is not compacted, and the process's gen-2 collections rose from a
    handful per day to several per minute.</p>
    <p>The measured fixes, in order of effort:</p>
    <ul>
      <li><strong>Swapping the two loops</strong> so the day index varies innermost: eleven
      seconds to roughly two. One line moved, no logic changed.</li>
      <li><strong>Reusing one matrix across regions</strong> instead of allocating per batch:
      gen-2 collections back to baseline. The array is cleared with
      <code>Array.Clear</code> — a block operation — rather than reallocated.</li>
    </ul>
    <p>What makes this worth a section is that <strong>neither problem is visible in the code's
    logic</strong>. Both versions of the loop are correct, produce identical output, and pass
    every test. Both versions of the allocation are correct. The difference is entirely in how
    the data sits in memory and how large it is — which is invisible unless you know that an
    array is a contiguous run of bytes and that 85,000 of them is a boundary.</p>
    <p>The cheap diagnostic that would have caught the first one at review: <em>in any nested
    loop over a grid, check that the last index changes fastest.</em></p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>int[,]</code> is faster than <code>int[][]</code> because it is one
    contiguous block."</strong></p>
    <p>Measured the other way round: 22 ms against 16 ms, with a flat <code>int[]</code> at
    11 ms. The rectangular array is a distinct runtime type whose indexing the JIT optimises far
    less aggressively than single-dimension arrays. Contiguity helps, but not enough to overcome
    the slower access path.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"You must write <code>i &lt; array.Length</code> so the JIT eliminates the bounds
    check."</strong></p>
    <p>Measured at 1.00x, 1.02x, and 1.04x against a loop bounded by a separate variable — no
    difference. This was worth doing on older runtimes; on .NET 10 it is folklore. Write the
    clearer form. If you genuinely need to remove checks from a numeric kernel, use
    <code>Span&lt;T&gt;</code>.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>Array.Resize</code> resizes the array."</strong></p>
    <p>It allocates a new array, copies every element, and reassigns your variable. The original
    is untouched and still visible to anyone else holding it. That is why the parameter is
    <code>ref</code>, and why calling it in a loop is quadratic.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A <code>readonly</code> array field is protected from modification."</strong></p>
    <p><code>readonly</code> prevents replacing the array, not changing its contents.
    <code>_items[0] = "x"</code> compiles and works on a <code>readonly</code> field. There is no
    read-only array type in C#; use <code>IReadOnlyList&lt;T&gt;</code>,
    <code>ReadOnlySpan&lt;T&gt;</code>, or <code>ImmutableArray&lt;T&gt;</code> when you need the
    guarantee.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Returning <code>null</code> instead of an empty array.</strong></p>
    <p>It forces every caller to null-check, and one will forget. Return
    <code>Array.Empty&lt;T&gt;()</code>, which is a shared cached instance and costs no
    allocation at all.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Reaching for an array by default.</strong></p>
    <p>Arrays are the right choice when the length is known and fixed, when the data is hot and
    numeric, or when an API demands one. For almost everything else — a collection you build up,
    pass around, and query — <code>List&lt;T&gt;</code> is the better default. It is an array
    underneath, so you keep the contiguity, and it manages growth correctly.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Situation</th><th>Use</th><th>Because</th></tr></thead>
      <tbody>
        <tr><td>A collection you build up as you go</td><td><code>List&lt;T&gt;</code></td><td>An array underneath, with correct amortised growth. Pass the expected size to the constructor.</td></tr>
        <tr><td>A fixed number of items, known up front</td><td><code>T[]</code></td><td>One allocation, no growth machinery, lowest overhead.</td></tr>
        <tr><td>A grid, small or cold</td><td><code>T[,]</code></td><td><code>grid[r, c]</code> is the clearest. A 2x access cost on a small grid is irrelevant.</td></tr>
        <tr><td>A grid, large and hot</td><td>Flat <code>T[]</code> + an indexer</td><td>Measured about twice as fast, with the arithmetic hidden from callers.</td></tr>
        <tr><td>Rows of genuinely different lengths</td><td><code>T[][]</code></td><td>The case jagged arrays exist for.</td></tr>
        <tr><td>Returning a collection from a public method</td><td><code>IReadOnlyList&lt;T&gt;</code></td><td>An array hands out write access to your internals.</td></tr>
        <tr><td>Nothing to return</td><td><code>Array.Empty&lt;T&gt;()</code></td><td>Shared instance, zero allocation, no null checks for callers.</td></tr>
        <tr><td>A per-request buffer over ~21,000 <code>int</code>s</td><td><code>ArrayPool&lt;T&gt;.Shared</code></td><td>Keeps repeated medium-large allocations off the Large Object Heap.</td></tr>
        <tr><td>A window over part of an array</td><td><code>Span&lt;T&gt;</code></td><td>No copy, no allocation. Covered in <a href="#/m/t2-19-span-and-memory">Span and Memory</a>.</td></tr>
        <tr><td>Lookup by key rather than position</td><td><code>Dictionary&lt;K,V&gt;</code></td><td>Scanning an array for a match inside a loop is quadratic.</td></tr>
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
    <p>Predict the output of each fragment, and name the rule that produces it.</p>
<pre data-lang="csharp" data-net="10"><code>// (a)
int[] a = { 1, 2, 3 };
int[] b = a;
b[0] = 99;
Console.WriteLine(a[0]);

// (b)
int[] left = { 1, 2, 3 };
int[] right = { 1, 2, 3 };
Console.WriteLine(left == right);

// (c)
int[] grown = { 1, 2, 3 };
int[] alias = grown;
Array.Resize(ref grown, 5);
Console.WriteLine($"{grown.Length} {alias.Length}");

// (d)
int[] sorted = { 10, 20, 30, 40, 50 };
Console.WriteLine(Array.BinarySearch(sorted, 35));

// (e)
Console.WriteLine(new bool[2][0]);</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <ul>
          <li><strong>(a) prints <code>99</code>.</strong> An array variable holds a reference, so
          <code>b = a</code> copied the direction, not the elements. There is one array with two
          names.</li>
          <li><strong>(b) prints <code>False</code>.</strong> <code>==</code> on arrays compares
          references. Two arrays with identical contents are still two arrays. Use
          <code>SequenceEqual</code> to compare contents.</li>
          <li><strong>(c) prints <code>5 3</code>.</strong> <code>Array.Resize</code> allocated a
          new 5-element array and pointed <code>grown</code> at it. <code>alias</code> still
          refers to the original 3-element array, which was never touched.</li>
          <li><strong>(d) prints <code>-4</code>.</strong> 35 is not present.
          <code>BinarySearch</code> returns the bitwise complement of the insertion point: 35
          would go at index 3, and <code>~3</code> is <code>-4</code>. To get the insertion point
          back, apply <code>~</code> again.</li>
          <li><strong>(e) does not compile.</strong> <code>new bool[2][0]</code> is
          <code>error CS0178: Invalid rank specifier: expected ',' or ']'</code>. A jagged array
          is created one dimension at a time — <code>new bool[2][]</code>, then each row
          separately.</li>
        </ul>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This class is used to accumulate daily totals during a batch that processes about 40,000
    transactions. It has four problems from this module. Find them, say what each causes, and
    rewrite it.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public class DailyTotals
{
    private readonly decimal[] _amounts = new decimal[0];
    private int _count;

    public decimal[] Amounts =&gt; _amounts;

    public void Add(decimal amount)
    {
        Array.Resize(ref _amounts, _count + 1);
        _amounts[_count] = amount;
        _count++;
    }

    public decimal Total()
    {
        decimal total = 0m;
        for (int i = 0; i &lt;= _count; i++)
        {
            total += _amounts[i];
        }
        return total;
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>0. It does not compile.</strong> <code>Array.Resize(ref _amounts, ...)</code>
        cannot take a <code>readonly</code> field as a <code>ref</code> argument:</p>
<pre data-lang="console" data-title="Compiler output"><code>error CS0192: A readonly field cannot be used as a ref or out value (except in a constructor)</code></pre>
        <p>That error is the first clue the design is wrong: the class wants a growable
        collection and has declared a fixed one.</p>

        <p><strong>1. Growing with <code>Array.Resize</code> per item is quadratic.</strong> Each
        call allocates a new array and copies everything. Measured at 2,011 ms for 80,000 items
        against 0 ms for <code>List&lt;T&gt;</code>; at 40,000 it was 319 ms — for work that
        should be free.</p>

        <p><strong>2. <code>Amounts</code> hands out the internal array.</strong> Any caller can
        write to it, and <code>readonly</code> on the field prevents only replacement, not
        modification. The class has no control over its own state.</p>

        <p><strong>3. <code>i &lt;= _count</code> is an off-by-one.</strong> Valid indexes run to
        <code>_count - 1</code>, so this reads one past the last item —
        <code>IndexOutOfRangeException</code> whenever the array is exactly full.</p>

        <p><strong>4. At 40,000 <code>decimal</code>s the buffer is on the Large Object
        Heap.</strong> A <code>decimal</code> is 16 bytes, so the LOH threshold is about 5,311
        elements. Reallocating repeatedly past that point fragments the heap and forces
        generation-2 collections.</p>

        <p>The rewrite:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public sealed class DailyTotals
{
    private readonly List&lt;decimal&gt; _amounts;

    public DailyTotals(int expectedCount = 0)
    {
        // Sizing up front removes every reallocation and copy.
        _amounts = expectedCount &gt; 0
            ? new List&lt;decimal&gt;(expectedCount)
            : new List&lt;decimal&gt;();
    }

    // Read-only to callers; they cannot write through this.
    public IReadOnlyList&lt;decimal&gt; Amounts =&gt; _amounts;

    public int Count =&gt; _amounts.Count;

    public void Add(decimal amount) =&gt; _amounts.Add(amount);

    public decimal Total()
    {
        decimal total = 0m;
        for (int i = 0; i &lt; _amounts.Count; i++)   // '&lt;', not '&lt;='
        {
            total += _amounts[i];
        }
        return total;
    }
}</code></pre>
        <p>What changed: <code>List&lt;T&gt;</code> gives amortised constant-time growth by
        doubling; the constructor takes an expected size so even that is avoided;
        <code>IReadOnlyList</code> stops callers writing to the internals; and the loop bound is
        corrected.</p>
        <p><strong>On the Large Object Heap:</strong> a single 40,000-element
        <code>decimal</code> buffer is still 640 KB and still on the LOH — that is unavoidable if
        you must hold them all. What the fix removes is the <em>repeated</em> allocation of
        progressively larger arrays, which is what fragments the heap. If the totals do not all
        need to be kept, the better answer is not to store them at all and accumulate a running
        sum instead.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A report over a 5,000 × 400 grid takes 4 seconds. The logic is correct and the output is
    right. Describe how you would establish that memory access order is the cause rather than the
    arithmetic, and what you would change.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>decimal[,] grid = LoadGrid();          // [account, day]

decimal total = 0m;
for (int day = 0; day &lt; grid.GetLength(1); day++)
{
    for (int account = 0; account &lt; grid.GetLength(0); account++)
    {
        total += grid[account, day];
    }
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Reading the code first.</strong> The array is indexed
        <code>[account, day]</code>, so C# lays it out one complete account-row at a time — all
        of account 0's days, then all of account 1's. The loops iterate day-outer,
        account-inner, so consecutive reads jump a whole account-row apart:
        400 × 16 bytes = 6,400 bytes per step. Every read fetches a fresh 64-byte cache line and
        uses 16 bytes of it.</p>

        <p><strong>Establishing it is memory and not arithmetic.</strong> Three checks, none
        needing a profiler:</p>
        <ol>
          <li><strong>Swap the loops and measure.</strong> If the arithmetic were the cost,
          swapping two loop headers would change nothing. Measured on an equivalent grid, this
          one change gave 21 ms against 112 ms.</li>
          <li><strong>Shrink until it fits in cache.</strong> Run over a 200 × 400 grid — about
          1.2 MB, cache-resident — and compare the two orders. If the difference collapses at
          small sizes and returns at large ones, it is cache behaviour, since the instruction
          count per element is identical at every size.</li>
          <li><strong>Check scaling.</strong> Doubling the account count should roughly double a
          linear job. If it more than doubles while the element count exactly doubles, you are
          paying a growing per-element memory cost rather than doing more work.</li>
        </ol>

        <p><strong>The change.</strong> Swap the loops so the last index varies fastest:</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>decimal total = 0m;
int accounts = grid.GetLength(0);
int days = grid.GetLength(1);

for (int account = 0; account &lt; accounts; account++)
{
    for (int day = 0; day &lt; days; day++)     // the LAST index changes fastest
    {
        total += grid[account, day];
    }
}</code></pre>
        <p>The sum is identical — addition is commutative here — so this is safe. Note the
        lengths are hoisted out of the loop headers too; <code>GetLength</code> is a method call
        on a rectangular array rather than a field read.</p>

        <p><strong>If the day-outer order is required</strong> — for example because you need a
        per-day subtotal as you go — then the grid is stored the wrong way round for its access
        pattern. Store it as <code>[day, account]</code> instead, and the same loops become
        cache-friendly. <strong>The layout should follow the dominant access pattern</strong>,
        and if two patterns compete equally, measure both.</p>
        <p>Two further options if this stays hot: move to a flat <code>decimal[]</code> with
        computed indexing, measured at about half the access cost of <code>decimal[,]</code>; and
        note that a 5,000 × 400 <code>decimal</code> grid is 32 MB, so it lives on the Large
        Object Heap and should be allocated once and reused rather than per report.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write <code>RingBuffer&lt;T&gt;</code>: a fixed-capacity collection that keeps only the
    most recent <em>n</em> items, discarding the oldest when full. Adding must be constant time
    with no allocation after construction, and enumeration must yield items oldest-first.</p>
    <p>Then explain why the obvious implementation using <code>List&lt;T&gt;</code> is quadratic,
    and what your index arithmetic has to get right.</p>
<pre data-lang="csharp" data-net="10"><code>// var buffer = new RingBuffer&lt;int&gt;(3);
// buffer.Add(1); buffer.Add(2); buffer.Add(3);   -&gt; 1, 2, 3
// buffer.Add(4);                                 -&gt; 2, 3, 4
public sealed class RingBuffer&lt;T&gt;
{
    public RingBuffer(int capacity) =&gt; throw new NotImplementedException();
    public int Count =&gt; throw new NotImplementedException();
    public void Add(T item) =&gt; throw new NotImplementedException();
    public IEnumerable&lt;T&gt; InOrder() =&gt; throw new NotImplementedException();
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why the obvious version fails.</strong> The natural implementation keeps a
        <code>List&lt;T&gt;</code> and removes the first element when full:</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>_items.Add(item);
if (_items.Count &gt; _capacity)
{
    _items.RemoveAt(0);       // shifts EVERY remaining element down one
}</code></pre>
        <p><code>RemoveAt(0)</code> on a list backed by an array must move every later element
        down one position, because an array's elements are contiguous and index 0 must stay index
        0. That is O(n) per add, so adding <em>m</em> items to a buffer of capacity <em>n</em>
        costs O(m × n). For a 10,000-capacity buffer taking a million events, that is ten billion
        element moves.</p>

        <p><strong>The insight:</strong> nothing requires the oldest item to sit at index 0. Keep
        the array still and move a <em>pointer</em> instead. That turns the O(n) shift into O(1)
        arithmetic.</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>public sealed class RingBuffer&lt;T&gt;
{
    private readonly T[] _items;
    private int _next;      // where the NEXT item will be written
    private int _count;     // how many slots are in use, capped at capacity

    public RingBuffer(int capacity)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(capacity);
        _items = new T[capacity];   // the only allocation this class ever makes
    }

    public int Capacity =&gt; _items.Length;

    public int Count =&gt; _count;

    public bool IsFull =&gt; _count == _items.Length;

    public void Add(T item)
    {
        _items[_next] = item;
        _next = (_next + 1) % _items.Length;   // wrap around

        if (_count &lt; _items.Length)
        {
            _count++;
        }
    }

    /// &lt;summary&gt;Yields the buffered items oldest first.&lt;/summary&gt;
    public IEnumerable&lt;T&gt; InOrder()
    {
        // Before the buffer fills, the oldest item is at 0. Once it has
        // wrapped, the oldest is wherever the write pointer now sits.
        int start = _count &lt; _items.Length ? 0 : _next;

        for (int i = 0; i &lt; _count; i++)
        {
            yield return _items[(start + i) % _items.Length];
        }
    }

    /// &lt;summary&gt;Logical index 0 is the oldest item.&lt;/summary&gt;
    public T this[int index]
    {
        get
        {
            ArgumentOutOfRangeException.ThrowIfNegative(index);
            ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(index, _count);

            int start = _count &lt; _items.Length ? 0 : _next;
            return _items[(start + index) % _items.Length];
        }
    }

    public void Clear()
    {
        // Array.Clear so held references can be collected; a ring buffer of
        // objects that never clears is a genuine leak.
        Array.Clear(_items, 0, _items.Length);
        _next = 0;
        _count = 0;
    }
}</code></pre>

        <p><strong>What the index arithmetic has to get right</strong> — these are the four places
        this goes wrong:</p>
        <ol>
          <li><strong>Two different "oldest" positions.</strong> Before the buffer has wrapped,
          the oldest item is at index 0. After wrapping, it is at <code>_next</code>, because the
          slot about to be overwritten is by definition the oldest. Handling only the second case
          gives wrong output for a partially filled buffer — the most common bug here, and one a
          test that only fills the buffer completely will never catch.</li>
          <li><strong><code>_count</code> must stop at capacity</strong> while <code>_next</code>
          keeps wrapping. Conflating them makes <code>Count</code> exceed the array length and
          the enumeration run off the end.</li>
          <li><strong>The modulo goes on the sum, not the parts.</strong>
          <code>(start + i) % length</code>, not <code>start + (i % length)</code>.</li>
          <li><strong><code>Clear</code> must actually clear.</strong> Setting
          <code>_count = 0</code> alone leaves the array holding references, so the objects stay
          alive for as long as the buffer does. For a <code>T</code> that is a reference type
          this is a real leak.</li>
        </ol>

        <p><strong>Cost.</strong> <code>Add</code> is one array write, one addition, one modulo:
        constant time, and after the constructor the class never allocates. Memory is exactly
        capacity elements regardless of how many items pass through.</p>
        <p><strong>Two notes for production.</strong> If capacity is a power of two you can
        replace <code>% length</code> with <code>&amp; (length - 1)</code>, which is measurably
        faster in a hot loop — the technique the framework's own buffers use. And this class is
        not thread-safe: two concurrent <code>Add</code> calls can write to the same slot. If you
        need that, the framework already provides <code>System.Threading.Channels</code> with a
        bounded capacity, which is the right answer rather than adding locks here.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>Why can an array not grow?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Its elements occupy one unbroken run of memory, and whatever sits immediately after it
        already belongs to something else. Growing means allocating a longer run elsewhere and
        copying everything across, which is exactly what <code>Array.Resize</code> and
        <code>List&lt;T&gt;</code> do.</p>
      </div></details>
    </li>
    <li>
      <p>Why is walking a grid column-by-column slower than row-by-row when the work is
      identical?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>C# stores a rectangular array row-major, so consecutive columns are adjacent in memory
        but consecutive rows are a whole row-width apart. The processor fetches 64 bytes at a
        time; walking rows uses all of it, walking columns discards most of it and pays a trip to
        main memory each step. Measured at <strong>3.1x to 5.7x</strong>.</p>
      </div></details>
    </li>
    <li>
      <p>Which is fastest: <code>int[,]</code>, <code>int[][]</code>, or a flat
      <code>int[]</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Flat <code>int[]</code> (11 ms), then jagged (16 ms), then rectangular (22 ms) &mdash;
        the rectangular array measuring 1.9x to 2.0x the flat one across runs.
        <code>int[,]</code> being slowest surprises people: it is a distinct runtime type whose
        indexing the JIT optimises far less than single-dimension arrays.</p>
      </div></details>
    </li>
    <li>
      <p>At what size does an array get allocated differently, and how many <code>int</code>s is
      that?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>At <strong>85,000 bytes</strong>, where it goes on the Large Object Heap — reported as
        generation 2, collected only in full collections, and not compacted by default. That is
        <strong>21,244 <code>int</code>s</strong> (84,976 bytes of elements plus a 24-byte
        header), or 10,622 references on a 64-bit process.</p>
      </div></details>
    </li>
    <li>
      <p>What does array covariance let you write, and what does it cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It lets a <code>string[]</code> be assigned to an <code>object[]</code> variable.
        Storing anything that is not a <code>string</code> through that variable compiles and then
        throws <code>ArrayTypeMismatchException</code> at run time. It also costs a type check on
        every store into a reference-type array. <code>List&lt;T&gt;</code> is invariant and
        catches the same mistake at build time.</p>
      </div></details>
    </li>
    <li>
      <p>Does <code>readonly</code> on an array field stop the contents changing?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. It stops the field being pointed at a different array; the elements remain
        writable. There is no read-only array type — use <code>IReadOnlyList&lt;T&gt;</code>,
        <code>ReadOnlySpan&lt;T&gt;</code>, or <code>ImmutableArray&lt;T&gt;</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Must you write <code>i &lt; array.Length</code> for the JIT to remove bounds checks?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Not on .NET 10. Measured against a loop bounded by a separate variable, the ratio was
        1.00x, 1.02x, and 1.04x — no difference. Write whichever form is clearer; use
        <code>Span&lt;T&gt;</code> if you genuinely need to remove checks from a numeric
        kernel.</p>
      </div></details>
    </li>
  </ol>

  <div class="callout callout--note">
    <h4>Where this leads</h4>
    <p><a href="#/m/t1-19-collections-overview">Collections and Their Cost Model</a> takes the
    array/<code>List</code>/<code>Dictionary</code> choice much further.
    <a href="#/m/t1-07-strings-and-interning">Strings, Immutability, and Interning</a> covers the
    array you use most often without realising — a <code>string</code> is a length and a run of
    characters. <a href="#/m/t2-19-span-and-memory">Span and Memory</a> is how you slice an array
    without copying it, and <a href="#/m/t2-17-gc-tuning">LOH, Server vs Workstation GC, and
    Allocation Pressure</a> picks up the 85,000-byte threshold and what to do about it at
    scale.</p>
  </div>
</section>

`
});
