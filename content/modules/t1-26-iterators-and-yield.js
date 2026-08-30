CSPREP.module({
  id: "t1-26-iterators-and-yield",
  minutes: 55,
  updated: "2026-08-30",
  summary: "One yield return turns a method into a class the compiler writes for you: a state machine that remembers where it stopped and resumes on the next MoveNext. Everything that follows — the validation that never runs, the finally that sometimes does not, the file handle held open across the caller's loop — is a consequence of the method body no longer being a method body.",
  terms: ["iterator", "iterator method", "yield return", "yield break", "state machine",
    "MoveNext", "Current", "resume point", "streaming", "eager", "argument validation",
    "local function", "chunking", "buffer reuse", "CS1626", "CS1631", "CS1623"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A nightly job in Ledger — the payments and invoicing service these modules keep returning
  to — has to total a 300,000-row invoice export. The obvious code reads the file into a list and
  adds up the amounts. It works, and it holds every row in memory at once to produce a single
  number.</p>

  <p>Scale that up and it stops working: a two-million-row export runs the process out of memory,
  and even before that, nothing at all happens for the first half-second because the total cannot
  start until the last row has been read.</p>

  <p>The fix is to produce rows one at a time and let the caller consume them as they arrive.
  Writing that by hand means a class with a position field, a current-item field, a method to
  advance, and correct behaviour when the caller stops halfway — perhaps sixty lines of
  bookkeeping for a loop that was four lines.</p>

  <p>C# has a keyword that makes the compiler write those sixty lines. <strong>It also silently
  changes what your method is, which is where the failures come from</strong>: validation that
  never runs, a file handle that stays open, an exception that surfaces in a stack frame the caller
  has never heard of. This module is about the keyword and about all three.</p>
</section>

<section id="what-it-is">
  <h2>What <code>yield</code> actually does</h2>

  <p class="define"><span class="define__term">Iterator</span> An object that produces a sequence
  one element at a time, on demand. It has a current element and a way to advance to the next.
  <span class="define__term">Iterator method</span> a method containing <code>yield return</code>.
  The compiler rewrites it into a class implementing that behaviour.</p>

  <p class="define"><span class="define__term">yield return</span> A statement that hands one value
  to whoever is consuming the sequence and <em>pauses the method there</em>. Execution resumes at
  the following statement the next time a value is asked for.
  <span class="define__term">yield break</span> ends the sequence early, like <code>return</code>
  in an ordinary method.</p>

  <p>The analogy: an ordinary method is a task you hand over and get back a finished result;
  <strong>an iterator method is a conversation</strong>. You ask for a value, it produces one and
  waits; you ask again, it picks up mid-sentence. <strong>The analogy breaks in one important
  place</strong> — a conversation partner is a separate thing that exists independently, but the
  iterator does not exist until you ask, and if you never ask, none of it ever happens.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-the-state-machine.cs"><code>// 01-the-state-machine.cs — what the compiler builds for a method containing
// &#96;yield return&#96;, read out of the assembly's own metadata rather than asserted.
// .NET 10.0.400. Run: dotnet run 01-the-state-machine.cs
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

class Program
{
    static IEnumerable&lt;int&gt; Counting()
    {
        Console.WriteLine("    [body] start");
        yield return 1;
        Console.WriteLine("    [body] after first yield");
        yield return 2;
        Console.WriteLine("    [body] after second yield");
    }

    static void Main()
    {
        Console.WriteLine("--- calling the method runs NONE of its body ---");
        var seq = Counting();
        Console.WriteLine($"  returned object type : {seq.GetType().Name}");
        Console.WriteLine("  (nothing printed from the body above this line)");

        Console.WriteLine();
        Console.WriteLine("--- stepping it by hand ---");
        var e = seq.GetEnumerator();
        Console.WriteLine($"  enumerator type : {e.GetType().Name}");
        Console.WriteLine($"  same object?    : {ReferenceEquals(seq, e)}");
        while (e.MoveNext())
            Console.WriteLine($"  MoveNext -&gt; true, Current = {e.Current}");
        Console.WriteLine("  MoveNext -&gt; false");

        Console.WriteLine();
        Console.WriteLine("--- what the compiler generated ---");
        var generated = typeof(Program).Assembly.GetTypes()
            .Where(t =&gt; t.Name.Contains("d__"))
            .ToArray();
        foreach (var t in generated)
        {
            Console.WriteLine($"  type : {t.Name}");
            Console.WriteLine($"    nested in : {t.DeclaringType?.Name}");
            Console.WriteLine($"    is class  : {t.IsClass}");
            Console.WriteLine($"    interfaces: {string.Join(", ", t.GetInterfaces().Select(i =&gt; i.Name).OrderBy(n =&gt; n))}");
            var fields = t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            Console.WriteLine($"    fields    : {string.Join(", ", fields.Select(f =&gt; f.Name))}");
        }
        Console.WriteLine("  ONE class implements both IEnumerable&lt;T&gt; and IEnumerator&lt;T&gt;.");
        Console.WriteLine("  &lt;&gt;1__state is the resume point. &lt;&gt;2__current is what Current returns.");

        Console.WriteLine();
        Console.WriteLine("--- one object serves the first foreach, then clones itself ---");
        var shared = Counting();
        var a = shared.GetEnumerator();
        var b = shared.GetEnumerator();
        Console.WriteLine($"  first GetEnumerator is the object itself : {ReferenceEquals(shared, a)}");
        Console.WriteLine($"  second GetEnumerator is a copy           : {!ReferenceEquals(shared, b)}");
        Console.WriteLine("  So a second foreach starts from the beginning. The iterator is");
        Console.WriteLine("  re-runnable, unlike a hand-written enumerator that keeps state.");

        Console.WriteLine();
        Console.WriteLine("--- the non-generic interfaces are there too ---");
        Console.WriteLine($"  is IEnumerable      : {seq is IEnumerable}");
        Console.WriteLine($"  is IEnumerable&lt;int&gt; : {seq is IEnumerable&lt;int&gt;}");
        Console.WriteLine($"  is IEnumerator&lt;int&gt; : {seq is IEnumerator&lt;int&gt;}");
        Console.WriteLine($"  is IDisposable      : {seq is IDisposable}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- calling the method runs NONE of its body ---
  returned object type : &lt;Counting&gt;d__0
  (nothing printed from the body above this line)

--- stepping it by hand ---
  enumerator type : &lt;Counting&gt;d__0
  same object?    : True
    [body] start
  MoveNext -&gt; true, Current = 1
    [body] after first yield
  MoveNext -&gt; true, Current = 2
    [body] after second yield
  MoveNext -&gt; false

--- what the compiler generated ---
  type : &lt;Counting&gt;d__0
    nested in : Program
    is class  : True
    interfaces: IDisposable, IEnumerable, IEnumerable&amp;#96;1, IEnumerator, IEnumerator&amp;#96;1
    fields    : &lt;&gt;1__state, &lt;&gt;2__current, &lt;&gt;l__initialThreadId
  ONE class implements both IEnumerable&lt;T&gt; and IEnumerator&lt;T&gt;.
  &lt;&gt;1__state is the resume point. &lt;&gt;2__current is what Current returns.

--- one object serves the first foreach, then clones itself ---
  first GetEnumerator is the object itself : True
  second GetEnumerator is a copy           : True
  So a second foreach starts from the beginning. The iterator is
  re-runnable, unlike a hand-written enumerator that keeps state.

--- the non-generic interfaces are there too ---
  is IEnumerable      : True
  is IEnumerable&lt;int&gt; : True
  is IEnumerator&lt;int&gt; : True
  is IDisposable      : True</code></pre>

  <p><strong>The method returned an object called <code>&lt;Counting&gt;d__0</code> and ran none of
  its own body.</strong> Not one line. The name is not writable in C# — the angle brackets make sure
  of that — and it is a class the compiler generated, nested inside <code>Program</code>.</p>

  <p class="define"><span class="define__term">State machine</span> An object that remembers which
  step of a process it is on, so it can be stopped and restarted. The generated class stores that
  step number in <code>&lt;&gt;1__state</code>.
  <span class="define__term">Resume point</span> the value of that field: which
  <code>yield return</code> the method paused at.</p>

  <p>Three fields do all the work:</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Field</th><th>Holds</th></tr></thead>
    <tbody>
      <tr><td><code>&lt;&gt;1__state</code></td>
          <td>Where to resume. Also encodes "not started" and "finished".</td></tr>
      <tr><td><code>&lt;&gt;2__current</code></td>
          <td>The value the last <code>yield return</code> produced. <code>Current</code> reads
          it.</td></tr>
      <tr><td><code>&lt;&gt;l__initialThreadId</code></td>
          <td>Which thread called the method, so the object can decide whether it may hand
          <em>itself</em> back from <code>GetEnumerator</code> or must make a copy.</td></tr>
    </tbody>
  </table>
  </div>

  <p class="define"><span class="define__term">Dispose</span> The method on
  <code>IEnumerator&lt;T&gt;</code> that releases whatever the enumeration holds. On a generated
  iterator it resumes the paused body inside its <code>finally</code> blocks and runs them, which
  is the whole mechanism behind resource cleanup in a streaming method.</p>

  <p class="define"><span class="define__term">MoveNext</span> The method that runs the body up to
  the next <code>yield return</code> and returns <code>true</code>, or returns <code>false</code>
  when the body finishes. <span class="define__term">Current</span> a property holding the value
  the last <code>MoveNext</code> produced.</p>

  <p><strong>One class implements both <code>IEnumerable&lt;T&gt;</code> and
  <code>IEnumerator&lt;T&gt;</code>.</strong> That is an optimisation, and the thread-id field is
  what makes it safe: the first <code>GetEnumerator</code> on the calling thread returns the object
  itself (measured: <code>True</code>), and any later call returns a fresh copy (measured: a
  different object). So a second <code>foreach</code> over the same variable starts from the
  beginning rather than finding an exhausted enumerator.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>This is why an iterator method is re-runnable and a hand-written enumerator usually
    is not.</strong> If you write a class that implements <code>IEnumerator&lt;T&gt;</code> and hand
    the same instance to two <code>foreach</code> loops, the second finds it already at the end. The
    generated iterator sidesteps that by cloning. It also means enumerating one twice runs the body
    twice — the deferral behaviour from
    <a href="#/m/t1-25-deferred-execution">Deferred Execution and the Cost of LINQ</a>, arriving
    from the producing side this time.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest thing worth writing</h2>

  <p class="define"><span class="define__term">Streaming</span> Producing and consuming elements one
  at a time, so only one is in memory at once. <span class="define__term">Eager</span> the
  opposite: computing every element before returning any. <code>ToList()</code> turns a streaming
  sequence into an eager one.</p>

  <p>An iterator earns its place the moment the sequence is not already in memory. Here it is
  producing a sequence that is infinite, which no collection can be:</p>

  <pre data-lang="csharp" data-net="10" data-title="An infinite sequence, consumed finitely"><code>using System;
using System.Collections.Generic;
using System.Linq;

// Runs forever if you let it. Nothing forces you to.
static IEnumerable&lt;long&gt; Fibonacci()
{
    long a = 0, b = 1;
    while (true)
    {
        yield return a;
        (a, b) = (b, a + b);
    }
}

foreach (var n in Fibonacci().Take(10))
    Console.Write($"{n} ");
Console.WriteLine();

// The first Fibonacci number over a million, without computing any others.
Console.WriteLine(Fibonacci().First(n =&gt; n &gt; 1_000_000));</code></pre>

  <pre data-lang="console" data-title="Output"><code>0 1 1 2 3 5 8 13 21 34
1346269</code></pre>

  <p><code>while (true)</code> in an ordinary method is a hang. In an iterator method it is a
  <strong>description of an unbounded sequence</strong>, and it terminates because
  <code>Take(10)</code> and <code>First(...)</code> stop asking. The producer never decides how much
  to produce; the consumer does.</p>
</section>

<section id="production-example">
  <h2>A realistic production example</h2>

  <p>Ledger exports invoices as CSV. The reader below streams them, and the class around it is what
  a real one looks like — validated, disposing its file handle, reporting the line number when a row
  is malformed.</p>

  <pre data-lang="csharp" data-net="10" data-title="04-production.cs"><code>// 04-production.cs — streaming a large export out of Ledger, the payments and
// invoicing service used throughout these modules. Measures what streaming buys
// against materialising, and what it costs when the consumer is slower.
// .NET 10.0.400. Run: dotnet run 04-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Ledger.Exports;

public sealed record Invoice(string Number, string CustomerId, decimal AmountMinor, DateOnly Issued);

/// &lt;summary&gt;Reads invoices from a file one line at a time. Never holds more than one.&lt;/summary&gt;
public sealed class InvoiceFileReader
{
    private readonly string _path;
    public InvoiceFileReader(string path) =&gt; _path = path;

    public IEnumerable&lt;Invoice&gt; ReadAll()
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(_path);
        return Iterate(_path);

        static IEnumerable&lt;Invoice&gt; Iterate(string path)
        {
            using var reader = new StreamReader(path);
            string? line;
            var lineNumber = 0;
            while ((line = reader.ReadLine()) is not null)
            {
                lineNumber++;
                var parts = line.Split(',');
                if (parts.Length != 4)
                    throw new FormatException($"line {lineNumber}: expected 4 fields, got {parts.Length}");

                yield return new Invoice(
                    parts[0],
                    parts[1],
                    decimal.Parse(parts[2], CultureInfo.InvariantCulture),
                    DateOnly.ParseExact(parts[3], "yyyy-MM-dd", CultureInfo.InvariantCulture));
            }
        }
    }

    /// &lt;summary&gt;The eager equivalent, for comparison. Reads everything before returning.&lt;/summary&gt;
    public IReadOnlyList&lt;Invoice&gt; ReadAllEagerly() =&gt; ReadAll().ToList();
}

class Program
{
    const int Rows = 300_000;

    static void Main()
    {
        var path = Path.Combine(Path.GetTempPath(), "ledger-invoices-demo.csv");
        Write(path, Rows);
        Console.WriteLine($"wrote {Rows:N0} invoice rows to a temp file " +
                          $"({new FileInfo(path).Length / 1024 / 1024} MB)");

        var reader = new InvoiceFileReader(path);

        Console.WriteLine();
        Console.WriteLine("--- total value, streaming ---");
        var streamed = Measure(() =&gt;
        {
            decimal total = 0;
            foreach (var inv in reader.ReadAll()) total += inv.AmountMinor;
            return total;
        });
        Console.WriteLine($"  total {streamed.result:N0} minor units");
        Console.WriteLine($"  {streamed.ms:0} ms, {streamed.bytes / 1024 / 1024:N0} MB allocated");

        Console.WriteLine();
        Console.WriteLine("--- total value, materialised first ---");
        var eager = Measure(() =&gt;
        {
            var all = reader.ReadAllEagerly();
            decimal total = 0;
            foreach (var inv in all) total += inv.AmountMinor;
            return total;
        });
        Console.WriteLine($"  total {eager.result:N0} minor units");
        Console.WriteLine($"  {eager.ms:0} ms, {eager.bytes / 1024 / 1024:N0} MB allocated");
        Console.WriteLine($"  same answer : {streamed.result == eager.result}");
        Console.WriteLine($"  allocation ratio : {(double)eager.bytes / streamed.bytes:0.0}x");
        Console.WriteLine("  Total allocation is nearly the same: both versions create one");
        Console.WriteLine("  Invoice per row. The difference is not how much is allocated,");
        Console.WriteLine("  it is how much is alive at once.");

        Console.WriteLine();
        Console.WriteLine("--- what is LIVE at the moment the answer is produced ---");
        var baseline = GC.GetTotalMemory(true);
        decimal t = 0;
        long liveWhileStreaming = 0;
        var seen = 0;
        foreach (var inv in reader.ReadAll())
        {
            t += inv.AmountMinor;
            if (++seen == Rows / 2) liveWhileStreaming = GC.GetTotalMemory(true) - baseline;
        }
        var list = reader.ReadAllEagerly();
        var liveWhileMaterialised = GC.GetTotalMemory(true) - baseline;
        Console.WriteLine($"  live heap halfway through streaming : {liveWhileStreaming / 1024:N0} KB");
        Console.WriteLine($"  live heap holding the whole list    : {liveWhileMaterialised / 1024 / 1024:N0} MB");
        Console.WriteLine($"  ratio : {(double)liveWhileMaterialised / Math.Max(liveWhileStreaming, 1):N0}x");
        GC.KeepAlive(list);
        GC.KeepAlive(t);

        Console.WriteLine();
        Console.WriteLine("--- peak working set is the real difference ---");
        Console.WriteLine("  Streaming holds ONE Invoice at a time. Materialising holds");
        Console.WriteLine($"  all {Rows:N0} plus the list's backing array, and cannot start");
        Console.WriteLine("  producing an answer until the last row is read.");

        Console.WriteLine();
        Console.WriteLine("--- first result latency ---");
        var sw = Stopwatch.StartNew();
        var firstStreamed = reader.ReadAll().First();
        sw.Stop();
        var t1 = sw.Elapsed.TotalMilliseconds;
        sw.Restart();
        var firstEager = reader.ReadAllEagerly()[0];
        sw.Stop();
        Console.WriteLine($"  streaming    : {t1:0.00} ms to the first invoice ({firstStreamed.Number})");
        Console.WriteLine($"  materialised : {sw.Elapsed.TotalMilliseconds:0.00} ms ({firstEager.Number})");
        Console.WriteLine("  The streaming reader stopped after one line. &#96;using&#96; inside the");
        Console.WriteLine("  iterator still closed the file, because First() disposes the");
        Console.WriteLine("  enumerator when it stops early.");

        Console.WriteLine();
        Console.WriteLine("--- a malformed row surfaces where the caller is looking ---");
        var badPath = Path.Combine(Path.GetTempPath(), "ledger-invoices-bad.csv");
        File.WriteAllLines(badPath, new[]
        {
            "INV-1,CUST-1,1000,2026-01-05",
            "INV-2,CUST-2,2000,2026-01-06",
            "INV-3,CUST-3,not-enough-fields"
        });
        var badReader = new InvoiceFileReader(badPath);
        var read = 0;
        try
        {
            foreach (var inv in badReader.ReadAll()) read++;
        }
        catch (FormatException ex)
        {
            Console.WriteLine($"  read {read} invoices, then: {ex.Message}");
        }
        Console.WriteLine("  Two good rows were already processed when it threw. A streaming");
        Console.WriteLine("  pipeline has no transaction: partial work is visible by design.");

        File.Delete(path);
        File.Delete(badPath);
    }

    static void Write(string path, int rows)
    {
        using var w = new StreamWriter(path);
        var day = new DateOnly(2026, 1, 1);
        for (var i = 1; i &lt;= rows; i++)
            w.WriteLine($"INV-{i:D7},CUST-{i % 5000:D5},{(i % 90_000) + 100},{day.AddDays(i % 300):yyyy-MM-dd}");
    }

    static (decimal result, double ms, long bytes) Measure(Func&lt;decimal&gt; f)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        var sw = Stopwatch.StartNew();
        var r = f();
        sw.Stop();
        var after = GC.GetAllocatedBytesForCurrentThread();
        return (r, sw.Elapsed.TotalMilliseconds, after - before);
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>wrote 300,000 invoice rows to a temp file (11 MB)

--- total value, streaming ---
  total 12,629,880,000 minor units
  505 ms, 112 MB allocated

--- total value, materialised first ---
  total 12,629,880,000 minor units
  685 ms, 120 MB allocated
  same answer : True
  allocation ratio : 1.1x
  Total allocation is nearly the same: both versions create one
  Invoice per row. The difference is not how much is allocated,
  it is how much is alive at once.

--- what is LIVE at the moment the answer is produced ---
  live heap halfway through streaming : 7 KB
  live heap holding the whole list    : 47 MB
  ratio : 6,607x

--- peak working set is the real difference ---
  Streaming holds ONE Invoice at a time. Materialising holds
  all 300,000 plus the list's backing array, and cannot start
  producing an answer until the last row is read.

--- first result latency ---
  streaming    : 0.34 ms to the first invoice (INV-0000001)
  materialised : 451.83 ms (INV-0000001)
  The streaming reader stopped after one line. &amp;#96;using&amp;#96; inside the
  iterator still closed the file, because First() disposes the
  enumerator when it stops early.

--- a malformed row surfaces where the caller is looking ---
  read 2 invoices, then: line 3: expected 4 fields, got 3
  Two good rows were already processed when it threw. A streaming
  pipeline has no transaction: partial work is visible by design.</code></pre>

  <p><strong>Total allocation was almost identical — 112 MB against 120 MB.</strong> Both versions
  create one <code>Invoice</code> per row; that cost does not go away. Anyone who claims streaming
  "allocates less" is measuring the wrong thing.</p>

  <p><strong>What differs is what is alive at once: 7 KB against 47 MB, a factor of
  6,607.</strong> The streaming version holds one invoice and lets the garbage collector reclaim the
  previous one; the materialised version holds all 300,000 plus the list's backing array, and that
  is the number that decides whether the job survives a two-million-row export.</p>

  <p><strong>And 0.34 ms against 451.83 ms to the first invoice.</strong> The streaming reader read
  one line and stopped. That is the latency difference an API endpoint feels: time to first byte,
  not time to last.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>The <code>using</code> is inside the iterator, not around the call.</strong> That is
    what makes the file handle's lifetime match the <em>enumeration</em> rather than the method call.
    <a href="#/m/t1-25-deferred-execution">Deferred Execution and the Cost of LINQ</a> showed the
    failure this avoids: a method that opens a resource, returns a lazy query, and disposes on the
    way out, handing the caller something that throws
    <code>ObjectDisposedException</code>. Putting the <code>using</code> in the iterator body is the
    fix, and it works because <code>First()</code> disposes the enumerator when it stops early —
    verified above by the file being closed after one line.</p>
  </div>

  <p>Note the shape of <code>ReadAll</code>: a normal method that validates and then returns a
  <code>static</code> <span class="define__term">local function</span> — a method declared inside
  another method — which is the iterator. The next section is about why.</p>
</section>

<section id="deferred-validation">
  <h2>The bug this feature is most known for</h2>

  <p>If a method contains <code>yield return</code> anywhere, <strong>the whole body is
  deferred</strong>, including the lines at the top that check the arguments. The check does not run
  when the caller calls. It runs when somebody enumerates, which may be in a different method, a
  different class, or after the caller has returned.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-deferred-validation.cs"><code>// 02-deferred-validation.cs — the single most common iterator bug: argument
// validation that never runs at the call site, because the whole method body
// is deferred. Plus the standard two-method fix.
// .NET 10.0.400. Run: dotnet run 02-deferred-validation.cs

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    // WRONG: the throw is inside the iterator body, so it is deferred with it.
    static IEnumerable&lt;string&gt; BrokenBatches(IReadOnlyList&lt;string&gt; source, int size)
    {
        if (size &lt;= 0)
            throw new ArgumentOutOfRangeException(nameof(size), "size must be positive");

        for (var i = 0; i &lt; source.Count; i += size)
            yield return string.Join("+", source.Skip(i).Take(size));
    }

    // RIGHT: a normal method validates and returns; a private iterator does the work.
    static IEnumerable&lt;string&gt; Batches(IReadOnlyList&lt;string&gt; source, int size)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (size &lt;= 0)
            throw new ArgumentOutOfRangeException(nameof(size), "size must be positive");
        return Iterate(source, size);

        static IEnumerable&lt;string&gt; Iterate(IReadOnlyList&lt;string&gt; source, int size)
        {
            for (var i = 0; i &lt; source.Count; i += size)
                yield return string.Join("+", source.Skip(i).Take(size));
        }
    }

    static void Main()
    {
        var data = new[] { "a", "b", "c", "d", "e" };

        Console.WriteLine("--- the broken version: calling it with a bad argument ---");
        try
        {
            var q = BrokenBatches(data, 0);
            Console.WriteLine("  the call returned WITHOUT throwing");
            Console.WriteLine($"  returned type : {q.GetType().Name}");
        }
        catch (ArgumentOutOfRangeException)
        {
            Console.WriteLine("  threw at the call site");
        }

        Console.WriteLine();
        Console.WriteLine("--- it throws later, wherever the caller enumerates ---");
        var broken = BrokenBatches(data, 0);
        try
        {
            foreach (var b in broken) Console.WriteLine(b);
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  caught in the foreach: {ex.ParamName} — {ex.Message.Split('(')[0].Trim()}");
        }
        Console.WriteLine("  The stack trace points at MoveNext, not at the caller who");
        Console.WriteLine("  passed the bad value. The two can be far apart.");

        Console.WriteLine();
        Console.WriteLine("--- the fixed version throws where the mistake was made ---");
        try
        {
            var q = Batches(data, 0);
            Console.WriteLine("  the call returned without throwing (wrong)");
        }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  threw at the call site: {ex.ParamName}");
        }

        Console.WriteLine();
        Console.WriteLine("--- and still streams when the arguments are valid ---");
        foreach (var b in Batches(data, 2)) Console.WriteLine($"  {b}");

        Console.WriteLine();
        Console.WriteLine("--- the same shape catches a null source immediately ---");
        try
        {
            _ = Batches(null!, 2);
        }
        catch (ArgumentNullException ex)
        {
            Console.WriteLine($"  ArgumentNullException at the call site: {ex.ParamName}");
        }
        var lateNull = BrokenBatches(null!, 2);
        Console.WriteLine("  the broken version returned an object for a null source;");
        try
        {
            foreach (var b in lateNull) { }
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  enumerating it threw NullReferenceException — the worst");
            Console.WriteLine("  possible message, from the worst possible place.");
        }
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the broken version: calling it with a bad argument ---
  the call returned WITHOUT throwing
  returned type : &lt;BrokenBatches&gt;d__0

--- it throws later, wherever the caller enumerates ---
  caught in the foreach: size — size must be positive
  The stack trace points at MoveNext, not at the caller who
  passed the bad value. The two can be far apart.

--- the fixed version throws where the mistake was made ---
  threw at the call site: size

--- and still streams when the arguments are valid ---
  a+b
  c+d
  e

--- the same shape catches a null source immediately ---
  ArgumentNullException at the call site: source
  the broken version returned an object for a null source;
  enumerating it threw NullReferenceException — the worst
  possible message, from the worst possible place.</code></pre>

  <p><strong><code>BrokenBatches(data, 0)</code> returned an object.</strong> A method whose second
  line is <code>throw new ArgumentOutOfRangeException</code>, called with the exact argument that
  triggers it, returned normally. The throw is real, and it is stored inside a state machine waiting
  for someone to press play.</p>

  <p>The null case is worse. The broken version accepted <code>null</code>, and enumerating it threw
  <code>NullReferenceException</code> — an exception that names nothing, from a frame called
  <code>MoveNext</code>, in a class whose name has angle brackets in it.</p>

  <p class="define"><span class="define__term">Argument validation</span> Checking a method's
  parameters at the top and throwing immediately if they are unusable, so the exception's stack
  trace points at the caller who made the mistake. The value of doing it at all is that the trace
  names the culprit — which is exactly what deferral destroys.</p>

  <h3>The fix: split the method in two</h3>

  <pre data-lang="csharp" data-net="10" data-title="The standard shape"><code>// A normal method: no yield anywhere in ITS body, so it runs when called.
public static IEnumerable&lt;string&gt; Batches(IReadOnlyList&lt;string&gt; source, int size)
{
    ArgumentNullException.ThrowIfNull(source);
    if (size &lt;= 0)
        throw new ArgumentOutOfRangeException(nameof(size), "size must be positive");

    return Iterate(source, size);

    // A local function that IS the iterator. &#96;static&#96; so it cannot accidentally
    // capture anything from the outer method.
    static IEnumerable&lt;string&gt; Iterate(IReadOnlyList&lt;string&gt; source, int size)
    {
        for (var i = 0; i &lt; source.Count; i += size)
            yield return string.Join("+", source.Skip(i).Take(size));
    }
}</code></pre>

  <p>The outer method has no <code>yield</code>, so it is an ordinary method that runs immediately,
  validates, and returns the state machine the inner one produces. Measured: the fixed version threw
  at the call site with <code>ParamName</code> = <code>size</code>, and still streamed correctly with
  valid arguments.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>Every iterator in .NET's own libraries is written this way.</strong>
    <code>Enumerable.Where</code> throws <code>ArgumentNullException</code> the moment you call it
    with a null predicate, not when you enumerate — because it is a normal method returning a
    private iterator. When you write your own, matching that behaviour is not a nicety; a library
    that defers its argument checks is a library whose stack traces point at itself.</p>
  </div>
</section>

<section id="try-finally">
  <h2><code>try</code>/<code>finally</code>, and when it does not run</h2>

  <p>An iterator can be abandoned partway. That raises a question an ordinary method never faces:
  if the body is paused inside a <code>try</code> and nobody ever resumes it, does the
  <code>finally</code> run?</p>

  <pre data-lang="csharp" data-net="10" data-title="03-try-finally-and-dispose.cs"><code>// 03-try-finally-and-dispose.cs — when the finally block in an iterator runs,
// and the two ways it silently does not. This is the mechanism behind every
// "the file handle stayed open" bug in streaming code.
// .NET 10.0.400. Run: dotnet run 03-try-finally-and-dispose.cs

using System;
using System.Collections.Generic;

class Program
{
    static IEnumerable&lt;int&gt; Guarded(string label)
    {
        Console.WriteLine($"    [{label}] opening");
        try
        {
            yield return 1;
            yield return 2;
            yield return 3;
        }
        finally
        {
            Console.WriteLine($"    [{label}] CLOSING");
        }
    }

    static void Main()
    {
        Console.WriteLine("--- running to the end: finally runs ---");
        foreach (var n in Guarded("complete")) Console.WriteLine($"  got {n}");

        Console.WriteLine();
        Console.WriteLine("--- breaking out early: finally STILL runs ---");
        foreach (var n in Guarded("break"))
        {
            Console.WriteLine($"  got {n}");
            if (n == 2) break;
        }
        Console.WriteLine("  foreach compiles to try/finally { enumerator.Dispose(); },");
        Console.WriteLine("  and Dispose on an iterator runs its finally blocks.");

        Console.WriteLine();
        Console.WriteLine("--- an exception in the loop body: finally runs ---");
        try
        {
            foreach (var n in Guarded("throw"))
            {
                Console.WriteLine($"  got {n}");
                if (n == 2) throw new InvalidOperationException("boom");
            }
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine("  caught outside the loop");
        }

        Console.WriteLine();
        Console.WriteLine("--- abandoning the enumerator without disposing: finally does NOT run ---");
        var e = Guarded("abandoned").GetEnumerator();
        e.MoveNext();
        Console.WriteLine($"  pulled {e.Current} and walked away");
        e = null!;
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        Console.WriteLine("  after a full GC: no CLOSING line above.");
        Console.WriteLine("  The generated class has no finaliser. Nothing will ever run");
        Console.WriteLine("  that finally block. A file handle here stays open until the");
        Console.WriteLine("  process exits.");

        Console.WriteLine();
        Console.WriteLine("--- stepping by hand: dispose it yourself ---");
        var e2 = Guarded("manual").GetEnumerator();
        try
        {
            e2.MoveNext();
            Console.WriteLine($"  pulled {e2.Current}");
        }
        finally
        {
            e2.Dispose();
        }

        Console.WriteLine();
        Console.WriteLine("--- Dispose is idempotent, and MoveNext after it returns false ---");
        var e3 = Guarded("twice").GetEnumerator();
        e3.MoveNext();
        e3.Dispose();
        e3.Dispose();
        Console.WriteLine($"  MoveNext after Dispose : {e3.MoveNext()}");
        Console.WriteLine("  Only one CLOSING line above, and no exception.");

        Console.WriteLine();
        Console.WriteLine("--- what you cannot write: yield inside a try WITH a catch ---");
        Console.WriteLine("  CS1626: 'Cannot yield a value in the body of a try block with");
        Console.WriteLine("  a catch clause.' try/finally is allowed; try/catch is not.");
        Console.WriteLine("  Verified in 06-compile-errors.cs.txt, stored as .txt because it");
        Console.WriteLine("  is meant not to build. CS1631 and CS1623 are in there too.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- running to the end: finally runs ---
    [complete] opening
  got 1
  got 2
  got 3
    [complete] CLOSING

--- breaking out early: finally STILL runs ---
    [break] opening
  got 1
  got 2
    [break] CLOSING
  foreach compiles to try/finally { enumerator.Dispose(); },
  and Dispose on an iterator runs its finally blocks.

--- an exception in the loop body: finally runs ---
    [throw] opening
  got 1
  got 2
    [throw] CLOSING
  caught outside the loop

--- abandoning the enumerator without disposing: finally does NOT run ---
    [abandoned] opening
  pulled 1 and walked away
  after a full GC: no CLOSING line above.
  The generated class has no finaliser. Nothing will ever run
  that finally block. A file handle here stays open until the
  process exits.

--- stepping by hand: dispose it yourself ---
    [manual] opening
  pulled 1
    [manual] CLOSING

--- Dispose is idempotent, and MoveNext after it returns false ---
    [twice] opening
    [twice] CLOSING
  MoveNext after Dispose : False
  Only one CLOSING line above, and no exception.

--- what you cannot write: yield inside a try WITH a catch ---
  CS1626: 'Cannot yield a value in the body of a try block with
  a catch clause.' try/finally is allowed; try/catch is not.
  Verified in 06-compile-errors.cs.txt, stored as .txt because it
  is meant not to build. CS1631 and CS1623 are in there too.</code></pre>

  <p><strong>Three of the four cases ran the <code>finally</code>.</strong> Completing normally,
  breaking early, and throwing from inside the loop body all produced <code>CLOSING</code>, because
  <code>foreach</code> compiles to a <code>try</code>/<code>finally</code> that calls
  <code>Dispose()</code> on the enumerator, and an iterator's <code>Dispose</code> runs its pending
  <code>finally</code> blocks.</p>

  <p><strong>The fourth did not.</strong> Pulling one value by hand and abandoning the enumerator
  left the <code>finally</code> unrun through a full forced collection. The generated class has no
  finaliser, so nothing will ever run it. In the file-reading version of that code, the handle stays
  open until the process exits.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p><strong>A partially-consumed iterator that is never disposed leaks whatever its
    <code>finally</code> would have released.</strong> This is not a garbage-collection problem the
    runtime will eventually solve — the collector reclaims the object's memory and never runs its
    <code>finally</code>. <code>foreach</code> and every LINQ operator dispose correctly. Manual
    <code>GetEnumerator()</code> calls are the risk, and they should always be wrapped in
    <code>using</code>.</p>
  </div>

  <h3>What an iterator method may not contain</h3>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Error</th><th>Rule</th><th>Why</th></tr></thead>
    <tbody>
      <tr><td><code>CS1626</code></td>
          <td>Cannot <code>yield</code> in a <code>try</code> that has a <code>catch</code></td>
          <td>Resuming into the middle of a protected region with a handler cannot be expressed by
          the state machine. <code>try</code>/<code>finally</code> is allowed.</td></tr>
      <tr><td><code>CS1631</code></td>
          <td>Cannot <code>yield</code> inside a <code>catch</code> block</td>
          <td>Same reason.</td></tr>
      <tr><td><code>CS1623</code></td>
          <td>No <code>ref</code>, <code>in</code> or <code>out</code> parameters</td>
          <td>Parameters become fields of the generated class, and a reference to a caller's local
          cannot outlive the call.</td></tr>
    </tbody>
  </table>
  </div>

  <p>All three were produced by an actual compiler run, stored in
  <code>verification/t1-26-iterators-and-yield/06-compile-errors.cs.txt</code> — as
  <code>.txt</code>, because a file that is meant not to build has no business in a build.</p>

  <p><strong>The <code>catch</code> restriction is the one that changes how you write code.</strong>
  Wrapping a whole streaming loop in error handling is not available. What you do instead:</p>

  <pre data-lang="csharp" data-net="10" data-title="Handling errors around a yield"><code>// The &#96;catch&#96; has to live in the consumer, not the producer.
static IEnumerable&lt;Invoice&gt; ReadInvoices(string path)
{
    using var reader = new StreamReader(path);
    string? line;
    while ((line = reader.ReadLine()) is not null)
        yield return Parse(line);   // Parse may throw; that is the caller's problem
}

// The caller decides what a bad row means.
var good = new List&lt;Invoice&gt;();
try
{
    foreach (var invoice in ReadInvoices(path))
        good.Add(invoice);
}
catch (FormatException ex)
{
    logger.LogError(ex, "Export aborted after {Count} rows", good.Count);
}</code></pre>

  <p>If a single bad row should be skipped rather than fatal, the parse has to happen where a
  <code>catch</code> is legal — in a normal method the iterator calls, returning a success flag or a
  nullable result rather than throwing.</p>
</section>

<section id="async-iterators">
  <h2>The asynchronous form</h2>

  <p>Everything so far pulls synchronously: <code>MoveNext</code> returns a <code>bool</code>, so
  the thread blocks while the next element is produced. That is wrong for anything that waits on a
  network — a paged API, a database cursor, a message queue — where the thread should be doing
  other work rather than sitting on a socket.</p>

  <p class="define"><span class="define__term">IAsyncEnumerable&lt;T&gt;</span> The asynchronous
  counterpart of <code>IEnumerable&lt;T&gt;</code>. Its enumerator's
  <code>MoveNextAsync()</code> returns a <code>ValueTask&lt;bool&gt;</code> — a value you wait for
  rather than a value you have — and its <code>DisposeAsync()</code> returns a
  <code>ValueTask</code>.</p>

  <p class="define"><span class="define__term">await foreach</span> The loop that consumes one. It
  is <code>foreach</code> with an <code>await</code> on each step, and it compiles to the same
  try/finally shape with <code>DisposeAsync</code> instead of <code>Dispose</code>.</p>

  <pre data-lang="csharp" data-net="10" data-title="08-async-iterators.cs"><code>// 08-async-iterators.cs — the asynchronous form of the same feature. Same state
// machine idea, different interfaces, and one extra failure mode: cancellation
// that silently does nothing.
// .NET 10.0.400. Run: dotnet run 08-async-iterators.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    // An async iterator: &#96;async&#96;, returns IAsyncEnumerable&lt;T&gt;, uses yield return.
    static async IAsyncEnumerable&lt;int&gt; PagesAsync(
        int pages,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        for (var page = 1; page &lt;= pages; page++)
        {
            await Task.Delay(20, cancellationToken);      // stands in for a network call
            yield return page;
        }
    }

    // The same method WITHOUT the attribute. The token passed to WithCancellation
    // never reaches it. The compiler warns about exactly this, verbatim:
    //
    //   warning CS8425: Async-iterator 'Program.PagesIgnoringToken(int, CancellationToken)'
    //   has one or more parameters of type 'CancellationToken' but none of them is decorated
    //   with the 'EnumeratorCancellation' attribute, so the cancellation token parameter from
    //   the generated 'IAsyncEnumerable&lt;&gt;.GetAsyncEnumerator' will be unconsumed
    //
    // Suppressed here ONLY so this file can demonstrate the resulting behaviour with a
    // clean build. In real code the warning is the fix instruction.
#pragma warning disable CS8425
    static async IAsyncEnumerable&lt;int&gt; PagesIgnoringToken(
        int pages,
        CancellationToken cancellationToken = default)
    {
        for (var page = 1; page &lt;= pages; page++)
        {
            await Task.Delay(20, cancellationToken);
            yield return page;
        }
    }
#pragma warning restore CS8425

    static async Task Main()
    {
        Console.WriteLine("--- the generated type ---");
        var seq = PagesAsync(3);
        Console.WriteLine($"  returned type : {seq.GetType().Name}");
        Console.WriteLine($"  is IAsyncEnumerable&lt;int&gt; : {seq is IAsyncEnumerable&lt;int&gt;}");
        Console.WriteLine($"  is IEnumerable&lt;int&gt;      : {seq is IEnumerable&lt;int&gt;}");
        Console.WriteLine("  A different interface pair: IAsyncEnumerable/IAsyncEnumerator,");
        Console.WriteLine("  whose MoveNextAsync returns ValueTask&lt;bool&gt; and whose");
        Console.WriteLine("  DisposeAsync returns ValueTask.");

        Console.WriteLine();
        Console.WriteLine("--- await foreach consumes it ---");
        var sw = Stopwatch.StartNew();
        await foreach (var page in PagesAsync(3))
            Console.WriteLine($"  page {page} at {sw.Elapsed.TotalMilliseconds:0} ms");
        Console.WriteLine("  Each page arrived after its own await. Nothing buffered.");

        Console.WriteLine();
        Console.WriteLine("--- cancellation, done right ---");
        using var cts = new CancellationTokenSource(50);
        var got = 0;
        try
        {
            await foreach (var page in PagesAsync(100).WithCancellation(cts.Token))
                got++;
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine($"  cancelled after {got} pages");
        }

        Console.WriteLine();
        Console.WriteLine("--- cancellation, silently ignored ---");
        using var cts2 = new CancellationTokenSource(50);
        got = 0;
        var cancelled = false;
        try
        {
            await foreach (var page in PagesIgnoringToken(8).WithCancellation(cts2.Token))
                got++;
        }
        catch (OperationCanceledException)
        {
            cancelled = true;
        }
        Console.WriteLine($"  pages received : {got} of 8");
        Console.WriteLine($"  threw OperationCanceledException : {cancelled}");
        Console.WriteLine("  The compiler warned about this at build time: CS8425.");
        Console.WriteLine("  Without [EnumeratorCancellation], WithCancellation's token is");
        Console.WriteLine("  not passed to the method's parameter, so the awaits inside");
        Console.WriteLine("  never see it. The loop ran to completion past the deadline.");

        Console.WriteLine();
        Console.WriteLine("--- what you give up ---");
        Console.WriteLine("  There is no LINQ on IAsyncEnumerable&lt;T&gt; in the base library.");
        Console.WriteLine("  Where/Select/ToList over one need System.Linq.Async, or a");
        Console.WriteLine("  hand-written await foreach.");
        var manual = new List&lt;int&gt;();
        await foreach (var page in PagesAsync(3))
            if (page % 2 == 1) manual.Add(page * 10);
        Console.WriteLine($"  hand-written filter+project : {string.Join(", ", manual)}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- the generated type ---
  returned type : &lt;PagesAsync&gt;d__0
  is IAsyncEnumerable&lt;int&gt; : True
  is IEnumerable&lt;int&gt;      : False
  A different interface pair: IAsyncEnumerable/IAsyncEnumerator,
  whose MoveNextAsync returns ValueTask&lt;bool&gt; and whose
  DisposeAsync returns ValueTask.

--- await foreach consumes it ---
  page 1 at 37 ms
  page 2 at 79 ms
  page 3 at 110 ms
  Each page arrived after its own await. Nothing buffered.

--- cancellation, done right ---
  cancelled after 2 pages

--- cancellation, silently ignored ---
  pages received : 8 of 8
  threw OperationCanceledException : False
  The compiler warned about this at build time: CS8425.
  Without [EnumeratorCancellation], WithCancellation's token is
  not passed to the method's parameter, so the awaits inside
  never see it. The loop ran to completion past the deadline.

--- what you give up ---
  There is no LINQ on IAsyncEnumerable&lt;T&gt; in the base library.
  Where/Select/ToList over one need System.Linq.Async, or a
  hand-written await foreach.
  hand-written filter+project : 10, 30</code></pre>

  <p>The generated type is the same shape with a different name —
  <code>&lt;PagesAsync&gt;d__0</code> — and it implements
  <code>IAsyncEnumerable&lt;int&gt;</code> but <strong>not</strong>
  <code>IEnumerable&lt;int&gt;</code>. The two hierarchies do not meet, which is why no
  <code>foreach</code> will accept one and no LINQ operator will either.</p>

  <h3>The cancellation trap</h3>

  <p>An async iterator's <code>CancellationToken</code> parameter needs
  <code>[EnumeratorCancellation]</code>. Without it, the token the consumer supplies through
  <code>.WithCancellation(token)</code> goes to the generated
  <code>GetAsyncEnumerator(CancellationToken)</code> and never reaches the parameter your code
  awaits on.</p>

  <p><strong>Measured: 8 of 8 pages received, and no
  <code>OperationCanceledException</code>, from a loop with a 50 ms deadline against roughly 160 ms
  of work.</strong> The correctly-attributed version cancelled after 2 pages. Nothing failed
  loudly; the request ignored its own timeout.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: a token nothing can reach"><code>// WRONG. Measured: .WithCancellation(token) on this had no effect at all.
// The compiler says so at build time — CS8425:
//   "has one or more parameters of type 'CancellationToken' but none of them is
//    decorated with the 'EnumeratorCancellation' attribute, so the cancellation
//    token parameter from the generated 'IAsyncEnumerable&lt;&gt;.GetAsyncEnumerator'
//    will be unconsumed"
static async IAsyncEnumerable&lt;int&gt; PagesAsync(int pages, CancellationToken ct = default)
{
    for (var page = 1; page &lt;= pages; page++)
    {
        await Task.Delay(20, ct);
        yield return page;
    }
}

// Right: one attribute, and the consumer's token reaches every await.
static async IAsyncEnumerable&lt;int&gt; PagesAsync(
    int pages,
    [EnumeratorCancellation] CancellationToken ct = default)
{
    for (var page = 1; page &lt;= pages; page++)
    {
        await Task.Delay(20, ct);
        yield return page;
    }
}</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><strong>This is one of the few places where a C# warning is the entire bug report.</strong>
    CS8425 names the method, names the missing attribute, and explains the consequence. It is also a
    warning rather than an error, so a build with warnings-as-errors turned off ships it. If your
    project does not treat warnings as errors, this is a good argument for the ones in this
    family.</p>
  </div>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p><strong>There is no LINQ on <code>IAsyncEnumerable&lt;T&gt;</code> in the base
    library.</strong> No <code>Where</code>, no <code>Select</code>, no <code>ToList</code>. The
    options are the <code>System.Linq.Async</code> package or a hand-written
    <code>await foreach</code> that filters and projects inline — which is what the last measurement
    does. Async streams get a fuller treatment in Track 2, alongside the rest of
    <code>async</code>; what matters here is that the state-machine mechanism is identical and the
    failure modes in this module all still apply.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Argument validation in the iterator body</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the check never runs at the call site"><code>// WRONG. Measured: called with size = 0, this returned an object and did not throw.
public static IEnumerable&lt;string&gt; Batches(IReadOnlyList&lt;string&gt; source, int size)
{
    if (size &lt;= 0) throw new ArgumentOutOfRangeException(nameof(size));
    for (var i = 0; i &lt; source.Count; i += size)
        yield return string.Join("+", source.Skip(i).Take(size));
}</code></pre>

  <p>Split it: a normal method that validates, returning a private iterator that does the work.</p>

  <h3>2. Calling <code>GetEnumerator()</code> without disposing</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: the finally never runs"><code>// WRONG. Verified: no cleanup after GC.Collect(), WaitForPendingFinalizers()
// and a second GC.Collect(). The generated class has no finaliser.
var e = reader.ReadAll().GetEnumerator();
while (e.MoveNext())
{
    if (ShouldStop(e.Current)) return;   // the file handle is now held forever
    Process(e.Current);
}

// Right: one keyword.
using var e = reader.ReadAll().GetEnumerator();
while (e.MoveNext())
{
    if (ShouldStop(e.Current)) return;   // Dispose runs the iterator&amp;#x27;s finally
    Process(e.Current);
}</code></pre>

  <h3>3. Yielding a reused buffer</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: every element is the same array"><code>// WRONG for any consumer that keeps what it is given. Measured: ToList() over
// 1..9 in chunks of 3 gave "7,8,9 | 7,8,9 | 7,8,9" — three references to one array.
static IEnumerable&lt;int[]&gt; Chunk(IReadOnlyList&lt;int&gt; source, int size)
{
    var buffer = new int[size];
    var used = 0;
    foreach (var item in source)
    {
        buffer[used++] = item;
        if (used == size) { used = 0; yield return buffer; }
    }
}</code></pre>

  <p>It looks correct while streaming, because each chunk is consumed before the next overwrites it.
  It breaks the moment anything stores what it received. Exercise 4 measures both sides.</p>

  <h3>4. Assuming a second <code>foreach</code> is free</h3>

  <p>The iterator clones itself and runs the body again from the start. Over a file, that is a second
  full read. Over a network call, a second request.</p>

  <h3>5. Long-lived resources held open by a slow consumer</h3>

  <p>An iterator with <code>using var reader = new StreamReader(path)</code> holds that file open for
  as long as enumeration lasts. If the consumer does 200 ms of work per row, the handle is open for
  200 ms × rows. Correct, and occasionally not what the operations team wants.</p>

  <h3>6. Returning <code>IEnumerable&lt;T&gt;</code> when the work is already done</h3>

  <p>An iterator over an in-memory list adds a state machine, two interface calls per element, and
  the deferral hazards — to re-yield data that is already sitting in an array. If the collection
  exists, return it.</p>

  <h3>7. An async iterator whose cancellation token is unreachable</h3>

  <p>Missing <code>[EnumeratorCancellation]</code>. Measured: a 50 ms deadline over roughly 160 ms
  of work produced all 8 pages and no exception. The compiler warns — <code>CS8425</code> — and it
  is only a warning.</p>

  <h3>8. Side effects in an iterator nobody enumerates</h3>

  <p>The body runs zero times. Measured in
  <a href="#/m/t1-25-deferred-execution">Deferred Execution and the Cost of LINQ</a>: a projection
  whose lambda set a flag left the flag <code>False</code>. An iterator method that writes to a
  database and is never enumerated writes nothing, and reports no error.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>An exception's stack trace names <code>MoveNext</code> and a type with angle
    brackets.</strong> That frame is an iterator body, and the type name tells you which method:
    <code>&lt;ReadInvoices&gt;d__4.MoveNext()</code> is <code>ReadInvoices</code>. The frame
    <em>above</em> it is whoever enumerated, which is usually not whoever called. Look for the call
    site separately — it may be in a different class entirely.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>An argument exception arrives from a method the caller did not call.</strong>
    Deferred validation. Find the iterator method in the stack trace, check whether its argument
    checks are inside the body, and split it into a validating wrapper plus a private iterator.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>A file or connection stays open longer than expected.</strong> Two candidates. Either
    a consumer is slow and the enumeration is genuinely still running — check with
    <code>Process Explorer</code>'s handle view or <code>handle64.exe -p &lt;pid&gt;</code>, which
    lists the open file by path — or an enumerator was taken by hand and never disposed. For the
    second, add a temporary <code>Console.WriteLine</code> in the <code>finally</code>: if it never
    prints, nothing disposed it.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Every element of a materialised sequence is the same value.</strong> The producer is
    yielding a mutable object it reuses. Test it in one line:
    <code>ReferenceEquals(list[0], list[1])</code>. If that is <code>true</code>, the iterator
    handed out the same instance every time.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Stepping through an iterator in a debugger looks wrong.</strong> F10 over a
    <code>yield return</code> jumps back to the consumer, and the next F10 lands back inside the
    method at a line you did not expect. That is accurate — it <em>is</em> resuming. Put the
    breakpoint on the first line after the <code>yield</code> and look at
    <code>&lt;&gt;1__state</code> in the locals window to see the resume point directly.</p>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Deciding whether a method is an iterator at all.</strong> Search its body for
    <code>yield</code>. There is no attribute and no signature difference — an iterator method and a
    method returning <code>Enumerable.Empty&lt;T&gt;()</code> have identical signatures and entirely
    different behaviour. This is the only feature in C# where one keyword anywhere in a body changes
    when the whole body runs.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p><strong>A concrete case.</strong> Ledger's reconciliation job read the day's settlement file
    from a payment provider, parsed it, and matched each row against stored payments. The file was
    typically 40,000 rows and the job took about 30 seconds.</p>
    <p>The reader was written as an iterator with <code>using var reader = new
    StreamReader(path)</code> in its body — the correct shape. The consumer, however, called a
    remote fraud-scoring service for each row, taking about 120 ms per call.</p>
    <p>So the enumeration lasted 40,000 × 120 ms ≈ <strong>80 minutes</strong>, and the file handle
    stayed open for all of it. That was tolerable until the provider began writing the next day's
    file to the same directory and a cleanup script could not remove the previous one. On Windows the
    delete failed outright; the directory grew until the volume filled.</p>
    <p>The second failure came from a change intended to help. Someone added a retry around the
    scoring call, and when a batch failed repeatedly the code broke out of the loop and returned
    early. That part worked — <code>foreach</code> disposed the enumerator and closed the file. But a
    parallel code path had been written with <code>var e = reader.ReadAll().GetEnumerator()</code>
    and a manual <code>while (e.MoveNext())</code>, without <code>using</code>. When that loop
    returned early, <strong>the <code>finally</code> never ran and the handle was never
    released</strong> — measured behaviour, not a theory: an abandoned enumerator's
    <code>finally</code> did not run through a full forced collection.</p>
    <p>The fix was two lines: materialise the parse into memory (11 MB for 40,000 rows, which was
    always affordable) so the file is closed in under a second, and wrap the manual enumerator in
    <code>using</code>. Streaming was the wrong tool here — not because it was slow, but because
    <strong>it tied a scarce operating-system resource to the slowest consumer in the
    system</strong>.</p>
  </div>

  <p>The general principle: <strong>an iterator makes the lifetime of everything in its body equal
  to the lifetime of the caller's loop.</strong> That is exactly what you want when the resource is
  cheap and the data is large — the export reader above held 7 KB live instead of 47 MB, and
  produced its first row in 0.34 ms instead of 451.83 ms. It is exactly what you do not want when
  the resource is scarce and the consumer is slow.</p>

  <p>The question to ask is not "is streaming better". It is <strong>"who owns the resource, and how
  long is the slowest consumer going to hold it?"</strong> Streaming moves that decision from the
  method that opens the resource to the loop that consumes it, and that loop is often written by
  someone who does not know a file is involved.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"<code>yield return</code> returns from the method."</strong> It pauses it. The
    method resumes at the next statement on the following <code>MoveNext</code>. Measured: the
    body's log printed <code>start</code>, then <code>after first yield</code>, then
    <code>after second yield</code>, interleaved with the consumer's own output.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"An iterator method runs when you call it."</strong> It runs none of its body.
    Measured: the call returned <code>&lt;Counting&gt;d__0</code> and printed nothing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Streaming allocates less."</strong> Measured: 112 MB against 120 MB for the same
    300,000 rows — the objects get created either way. What streaming reduces is what is
    <em>live</em>: <strong>7 KB against 47 MB</strong>. Those are different claims and only the
    second one is true.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The garbage collector will run my <code>finally</code> eventually."</strong> It will
    not. There is no finaliser on the generated class. Measured: an abandoned enumerator's
    <code>finally</code> did not run through a full forced collection, and never will.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"You cannot use <code>try</code> in an iterator."</strong>
    <code>try</code>/<code>finally</code> is allowed and is how streaming resources are released.
    What is banned is a <code>catch</code> clause around a <code>yield</code>
    (<code>CS1626</code>) and yielding from inside a <code>catch</code> (<code>CS1631</code>).</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Enumerating twice reuses the first result."</strong> The iterator clones itself and
    runs the body again from the beginning. Measured: the first <code>GetEnumerator</code> returned
    the object itself, the second returned a copy.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Iterators are only for infinite or huge sequences."</strong> They are for any
    sequence you would otherwise build a temporary list to return — including small ones, where the
    win is that the code reads as a loop instead of a list-and-add. The cost is a state machine
    object per enumeration, which is nothing until it is in a hot path.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>Producing a sequence from a file, socket, or paged API</td>
          <td>An iterator, with <code>using</code> inside the body</td>
          <td>7 KB live against 47 MB, first result in 0.34 ms against 451.83 ms.</td></tr>
      <tr><td>The sequence is unbounded</td><td>An iterator</td>
          <td>No collection can hold it; the consumer decides when to stop.</td></tr>
      <tr><td>The method takes arguments worth checking</td>
          <td>A validating wrapper plus a private iterator</td>
          <td>Otherwise the check runs at enumeration, in a frame the caller never called.</td></tr>
      <tr><td>The data is already in memory</td><td>Return the collection</td>
          <td>An iterator over a list adds a state machine and every deferral hazard for
          nothing.</td></tr>
      <tr><td>The caller will enumerate more than once</td><td>Materialise, or document it</td>
          <td>Every enumeration re-runs the body — a second file read, a second request.</td></tr>
      <tr><td>The consumer is slow and holds a scarce resource</td><td>Materialise</td>
          <td>Streaming ties the handle's lifetime to the slowest consumer.</td></tr>
      <tr><td>You need <code>catch</code> around the producing code</td>
          <td>Parse in a normal method the iterator calls</td>
          <td><code>CS1626</code>: no <code>catch</code> around a <code>yield</code>.</td></tr>
      <tr><td>Yielding a mutable object you build up</td><td>Allocate a fresh one per element</td>
          <td>Otherwise every stored element is the same instance.</td></tr>
      <tr><td>Calling <code>GetEnumerator()</code> by hand</td><td><code>using var e = …</code></td>
          <td>Nothing else will ever run the <code>finally</code>.</td></tr>
      <tr><td>The producer waits on a network or a disk</td>
          <td><code>IAsyncEnumerable&lt;T&gt;</code> with
          <code>[EnumeratorCancellation]</code></td>
          <td>The thread is freed between elements — and without the attribute the caller&#x27;s
          timeout does nothing.</td></tr>
      <tr><td>Chunking a sequence</td><td><code>Enumerable.Chunk</code></td>
          <td>It is in the framework, it allocates per chunk deliberately, and it has the
          validation shape right.</td></tr>
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
    <p>Given this method, say what the log contains after each step: calling it, calling
    <code>GetEnumerator()</code>, the first <code>MoveNext()</code>, the second, and the third.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>static IEnumerable&lt;int&gt; Traced()
{
    Log.Add("A");
    yield return 1;
    Log.Add("B");
    yield return 2;
    Log.Add("C");
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>after calling Traced()      : []
after GetEnumerator()       : []
after first MoveNext()      : [A] Current=1
after second MoveNext()     : [A,B] Current=2
third MoveNext() returns    : False
log now                     : [A,B,C]</code></pre>
        <p><strong>Calling it logs nothing, and neither does <code>GetEnumerator()</code>.</strong>
        The first runs no body at all; the second returns the state machine (itself, on this thread)
        without advancing it.</p>
        <p>Each <code>MoveNext()</code> runs from the current resume point up to the next
        <code>yield return</code>, then stops. So <code>"A"</code> is logged by the first
        <code>MoveNext</code>, not by the call.</p>
        <p><strong>The last one is the part people get wrong.</strong> The third
        <code>MoveNext()</code> returns <code>false</code>, but it <em>did</em> run code: everything
        after the final <code>yield return</code>, which logged <code>"C"</code>. A cleanup line
        written after the last yield only runs if the consumer enumerates to exhaustion — a
        <code>break</code> at the second element would never reach it. That is why cleanup belongs in
        a <code>finally</code>, which runs on <code>Dispose</code> too.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>This method validates its argument and the validation does not work. Explain precisely when
    the exception is thrown, then rewrite it so it throws at the call site while still
    streaming.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 2"><code>static IEnumerable&lt;int&gt; TakeEveryNth(IReadOnlyList&lt;int&gt; source, int n)
{
    if (n &lt;= 0) throw new ArgumentOutOfRangeException(nameof(n));
    for (var i = 0; i &lt; source.Count; i += n) yield return source[i];
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>broken version: call returned without throwing
broken version: threw only on enumeration (n)
fixed version : threw at the call site (n)
and still works: 1, 4, 7, 10</code></pre>
        <p><strong>The exception is thrown on the first <code>MoveNext</code>, not on the
        call.</strong> Because the body contains <code>yield return</code>, the compiler moved all
        of it — the <code>if</code> included — into <code>MoveNext</code> on a generated class. The
        call itself does nothing but construct that object.</p>
        <p>In practice that means: a controller validates a query parameter by calling this method
        inside a <code>try</code>, sees no exception, returns the sequence, and the exception
        surfaces during response serialisation — after the status code has been decided.</p>
<pre data-lang="csharp" data-net="10" data-title="The fix"><code>static IEnumerable&lt;int&gt; TakeEveryNth(IReadOnlyList&lt;int&gt; source, int n)
{
    ArgumentNullException.ThrowIfNull(source);
    if (n &lt;= 0) throw new ArgumentOutOfRangeException(nameof(n));
    return Iterate(source, n);

    static IEnumerable&lt;int&gt; Iterate(IReadOnlyList&lt;int&gt; source, int n)
    {
        for (var i = 0; i &lt; source.Count; i += n) yield return source[i];
    }
}</code></pre>
        <p>The outer method now contains no <code>yield</code>, so it is an ordinary method: it runs
        when called, validates, and returns the iterator the local function creates. Measured: throws
        at the call site with <code>ParamName</code> = <code>n</code>, and still produces
        <code>1, 4, 7, 10</code> lazily.</p>
        <p><strong>Why <code>static</code> on the local function.</strong> Without it, the local
        function may capture variables from the enclosing method, which allocates a closure and makes
        it possible to accidentally depend on outer state. <code>static</code> forbids capture, so
        everything it uses must be passed as a parameter — which is what you want when the point of
        the split is that the two halves run at different times.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>For each of these four consumers of an iterator whose body has a <code>finally</code>, say
    whether the <code>finally</code> runs: (a) a complete <code>foreach</code>, (b) a
    <code>foreach</code> with <code>break</code>, (c) <code>.First()</code>, (d) a manual
    <code>GetEnumerator()</code> and one <code>MoveNext()</code>, then abandoned.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>(a) full foreach:
    CLOSE a
(b) foreach with break at 2:
    CLOSE b
(c) LINQ First():
    CLOSE c
(d) manual MoveNext, never disposed:
    (no CLOSE line for d)</code></pre>
        <p><strong>(a), (b) and (c) run it. (d) does not, ever.</strong></p>
        <p>The reason all three of the first cases work is one mechanism.
        <code>foreach (var x in seq) { … }</code> compiles to roughly:</p>
<pre data-lang="csharp" data-net="10" data-title="What foreach compiles to"><code>var e = seq.GetEnumerator();
try
{
    while (e.MoveNext()) { var x = e.Current; /* body */ }
}
finally
{
    (e as IDisposable)?.Dispose();
}</code></pre>
        <p>The <code>finally</code> there is the compiler's, and it runs however the loop
        ends — normally, via <code>break</code>, or via an exception. An iterator's
        <code>Dispose</code> resumes the body inside its own <code>finally</code> blocks and runs
        them. <code>First()</code> is the same shape: it takes an enumerator inside a
        <code>using</code>, calls <code>MoveNext</code> once, and disposes.</p>
        <p><strong>(d) is a real leak, not a delayed cleanup.</strong> The generated class has no
        finaliser, so the garbage collector reclaims the object's memory without ever running the
        pending <code>finally</code>. Verified: no <code>CLOSE</code> line after
        <code>GC.Collect()</code>, <code>WaitForPendingFinalizers()</code> and a second
        <code>GC.Collect()</code>. If that <code>finally</code> closed a file, the handle is held
        until the process exits.</p>
        <p>The fix is one keyword — <code>using var e = seq.GetEnumerator();</code> — and the rule
        it comes from is general: <strong>anything that hands you an
        <code>IEnumerator&lt;T&gt;</code> is handing you something disposable</strong>, which is why
        the generic interface extends <code>IDisposable</code> and the non-generic one does
        not.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>Write an iterator that yields a sequence in fixed-size chunks. Then explain why reusing one
    buffer array — which is faster and allocates less — is a bug, what it costs to fix, and how
    <code>Enumerable.Chunk</code> resolves the tension.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>reusing one array:
  while streaming : 1,2,3
  while streaming : 4,5,6
  while streaming : 7,8,9
  after ToList()  : 7,8,9 | 7,8,9 | 7,8,9
  all three are the same array : True
allocating per chunk:
  after ToList()  : 1,2,3 | 4,5,6 | 7,8,9
  all three are the same array : False

streaming 100,000 items in chunks of 100:
  reused buffer   : 536 bytes
  fresh per chunk : 424,560 bytes
  ratio           : 792.1x</code></pre>
<pre data-lang="csharp" data-net="10" data-title="The correct version"><code>static IEnumerable&lt;int[]&gt; Chunk(IReadOnlyList&lt;int&gt; source, int size)
{
    ArgumentNullException.ThrowIfNull(source);
    if (size &lt;= 0) throw new ArgumentOutOfRangeException(nameof(size));
    return Iterate(source, size);

    static IEnumerable&lt;int[]&gt; Iterate(IReadOnlyList&lt;int&gt; source, int size)
    {
        var buffer = new List&lt;int&gt;(size);
        foreach (var item in source)
        {
            buffer.Add(item);
            if (buffer.Count == size) { yield return buffer.ToArray(); buffer.Clear(); }
        }
        if (buffer.Count &gt; 0) yield return buffer.ToArray();   // the short final chunk
    }
}</code></pre>
        <p><strong>The reused-buffer version looks correct and is correct — while streaming.</strong>
        Printed inside the <code>foreach</code>, it gave <code>1,2,3</code> then <code>4,5,6</code>
        then <code>7,8,9</code>, because each chunk was consumed before the next overwrote it.</p>
        <p><strong>It breaks the moment anything keeps what it was given.</strong>
        <code>ToList()</code> produced <code>7,8,9 | 7,8,9 | 7,8,9</code> — three references to one
        array, holding whatever was written last. <code>ReferenceEquals</code> on the first two
        elements returned <code>True</code>.</p>
        <p>That is a nasty defect because <strong>it is invisible in the code that produces it and
        invisible in the code that consumes it</strong>. It appears only in the combination, and the
        combination changes when someone adds a <code>.ToList()</code> for an unrelated reason.</p>
        <p><strong>The fix costs 792×.</strong> 536 bytes against 424,560 for 100,000 items in chunks
        of 100 — an array per chunk instead of one for the whole run. That is the honest price of
        handing out objects the caller may keep.</p>
        <p><strong>What <code>Enumerable.Chunk</code> does.</strong> It allocates per chunk, exactly
        like the safe version, and does not offer a reusing overload. The framework will not hand you
        an object whose contents change behind your back, because the resulting bug is unfindable.
        Prefer it over writing your own — it also has the validating-wrapper shape right, throwing
        <code>ArgumentOutOfRangeException</code> at the call site.</p>
        <p><strong>When reuse is legitimate</strong>, the mechanism is not an iterator. It is a
        callback the consumer runs while the buffer is valid
        (<code>void ForEachChunk(ReadOnlySpan&lt;int&gt; chunk)</code>), or a rented array from
        <code>ArrayPool&lt;T&gt;</code> with the ownership rules written down. Both make the
        constraint visible in the signature, which <code>yield return buffer</code> never does.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does the compiler do to a method containing <code>yield return</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Rewrites it into a generated class — measured as <code>&lt;Counting&gt;d__0</code> — that
        implements <code>IEnumerable&lt;T&gt;</code>, <code>IEnumerator&lt;T&gt;</code> and
        <code>IDisposable</code>, with fields for the resume point
        (<code>&lt;&gt;1__state</code>) and the current value.</p>
      </div></details>
    </li>
    <li>
      <p>How much of the body runs when you call an iterator method?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>None of it.</strong> The call constructs the state machine and returns. The body
        runs on <code>MoveNext</code>.</p>
      </div></details>
    </li>
    <li>
      <p>Why does argument validation inside an iterator not work, and what is the fix?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The whole body is deferred, checks included — measured: called with an invalid argument,
        it returned an object without throwing. Fix: a normal method that validates and returns a
        private (<code>static</code> local function) iterator.</p>
      </div></details>
    </li>
    <li>
      <p>When does an iterator's <code>finally</code> run?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the enumerator is disposed — which <code>foreach</code>, <code>break</code>, an
        exception in the loop body, and every LINQ operator all do. <strong>Not</strong> when an
        enumerator taken by hand is abandoned: verified, no finaliser, never runs.</p>
      </div></details>
    </li>
    <li>
      <p>What can an iterator method not contain?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <code>yield</code> inside a <code>try</code> with a <code>catch</code>
        (<code>CS1626</code>), a <code>yield</code> in a <code>catch</code> block
        (<code>CS1631</code>), and <code>ref</code>/<code>in</code>/<code>out</code> parameters
        (<code>CS1623</code>). <code>try</code>/<code>finally</code> is allowed.</p>
      </div></details>
    </li>
    <li>
      <p>Does streaming allocate less than materialising?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Barely — measured 112 MB against 120 MB for 300,000 rows. What it reduces is what is
        <strong>live at once</strong>: <strong>7 KB against 47 MB</strong>, a factor of 6,607.</p>
      </div></details>
    </li>
    <li>
      <p>What happens on a second <code>foreach</code> over the same iterator variable?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The object clones itself and the body runs again from the start. Measured: the first
        <code>GetEnumerator</code> returned the object itself, the second a copy. Over a file, that
        is a second full read.</p>
      </div></details>
    </li>
    <li>
      <p>What is <code>&lt;&gt;l__initialThreadId</code> for?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>So the object can hand <em>itself</em> back from the first
        <code>GetEnumerator</code> on the creating thread — saving an allocation — and return a copy
        otherwise. It is what makes the one-class-two-interfaces trick safe.</p>
      </div></details>
    </li>
    <li>
      <p>Why is yielding a reused buffer a bug?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Every element is the same object. Correct while streaming, wrong the moment anything
        keeps it: measured, <code>ToList()</code> over chunks of 1..9 gave
        <code>7,8,9 | 7,8,9 | 7,8,9</code>. Allocating per chunk costs <strong>792×</strong> and is
        what <code>Enumerable.Chunk</code> does.</p>
      </div></details>
    </li>
    <li>
      <p>You see <code>&lt;ReadInvoices&gt;d__4.MoveNext()</code> in a stack trace. What does it tell
      you?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The exception came from the body of the iterator method <code>ReadInvoices</code>, running
        during enumeration. The frame above is whoever enumerated — <strong>not necessarily whoever
        called</strong> <code>ReadInvoices</code>.</p>
      </div></details>
    </li>
    <li>
      <p>When is streaming the wrong choice?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>When the data is already in memory, when the caller enumerates more than once, or when a
        <strong>slow consumer would hold a scarce resource</strong> — the incident above held a file
        handle for 80 minutes because each row triggered a 120 ms remote call.</p>
      </div></details>
    </li>
    <li>
      <p>What does <code>[EnumeratorCancellation]</code> do, and what happens without it?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It routes the token from <code>.WithCancellation(token)</code> into the method&#x27;s
        <code>CancellationToken</code> parameter. Without it the awaits never see the token:
        measured, <strong>8 of 8 pages delivered and no exception</strong> against a 50 ms deadline.
        The compiler warns with <code>CS8425</code> — and it is only a warning.</p>
      </div></details>
    </li>
    <li>
      <p>Where should cleanup code go, and why not after the last <code>yield return</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>In a <code>finally</code>. Code after the last <code>yield return</code> runs only if the
        consumer enumerates to exhaustion — a <code>break</code> skips it. A <code>finally</code>
        runs on <code>Dispose</code> as well.</p>
      </div></details>
    </li>
  </ol>
</section>
`
});
