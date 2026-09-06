CSPREP.module({
  id: "t2-18-finalisers-and-idisposable",
  minutes: 55,
  updated: "2026-09-02",
  summary: "Nothing in the runtime calls Dispose for you - measured, 1,000 abandoned objects produced zero disposals. A finaliser is a safety net that fires on the collector's schedule, and Ledger's archiver leaked exactly one OS handle per file while allocating almost nothing, so no collection was ever triggered and the net never deployed. Declaring a finaliser also costs every instance an extra collection: 200,000 finalisable objects still held 2.5 MB after a collection that reclaimed the plain ones entirely.",
  terms: ["IDisposable", "IAsyncDisposable", "Dispose", "DisposeAsync", "using statement",
    "using declaration", "await using", "deterministic cleanup", "unmanaged resource",
    "managed resource", "finaliser", "finalisation queue", "finaliser thread",
    "GC.SuppressFinalize", "the dispose pattern", "resurrection", "SafeHandle", "handle",
    "ownership", "captive dependency", "double dispose"],
  html: `
<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Ledger has a nightly job that writes one archive file per customer statement. It had run every
  night for two years without anyone touching it.</p>

  <p>One night it failed about twenty minutes in, with an <code>IOException</code> saying the process
  could not open a file. The disk had 400 GB free. Memory was flat at 180 MB. The job restarted
  cleanly and got a little further before failing again.</p>

  <p>The bug was one missing keyword, and it had been there since the first commit:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="The line that broke it"><code>// No using. The file is written correctly and the stream is never closed.
var stream = new FileStream(path, FileMode.Create, FileAccess.Write);
var writer = new StreamWriter(stream);
writer.Write(statement.Content);
writer.Flush();</code></pre>

  <p>Every iteration takes one file handle from the operating system and never gives it back.
  Measured, on exactly this loop:</p>

  <pre data-lang="console" data-title="04-production.cs"><code>   files written   handles   growth
             100       326     +100
             200       426     +200
             300       526     +300
             400       626     +400

   handles per file: 1.00</code></pre>

  <p>The interesting question is not why it failed. It is <strong>why it worked for two years.</strong></p>

  <p>The answer is that .NET has a safety net. <code>FileStream</code> holds a handle wrapper that
  carries a <em>finaliser</em> — a method the runtime calls before reclaiming an object — and that
  finaliser closes the handle. So the leak does get cleaned up. Measured, forcing a collection
  recovered exactly the 400 leaked handles.</p>

  <p>But the net only deploys when a garbage collection runs, and <strong>garbage collections are
  triggered by memory pressure.</strong> This loop leaks operating-system handles while allocating
  almost nothing. The collector had no reason to run. The job ran out of handles long before it ran
  out of memory, and the safety net was never asked to catch anything.</p>

  <p>That is the shape of this module. There are two completely different cleanup mechanisms in .NET
  — one you control exactly, one you do not control at all — and most resource bugs come from
  believing the second one will cover for the first.</p>
</section>

<section id="plain-language">
  <h2>Two kinds of cleanup</h2>

  <p class="define"><span class="define__term">Managed resource</span> Memory holding .NET objects.
  The garbage collector reclaims it automatically once nothing can reach it. You never free it by
  hand and you cannot free it early.</p>

  <p class="define"><span class="define__term">Unmanaged resource</span> Anything the runtime did not
  allocate and does not track: a file handle, a socket, a database connection, a mutex, a block of
  native memory, a window handle. The collector knows nothing about these. It sees an object of some
  size; it has no idea that object represents the last reference to an open socket.</p>

  <p class="define"><span class="define__term">Handle</span> A number the operating system gives you
  to identify a resource it is holding on your behalf. Handles are a limited, process-wide resource
  and they are <em>not</em> memory, which is why leaking them is invisible on a memory graph.</p>

  <p class="define"><span class="define__term">Deterministic cleanup</span> Cleanup that happens at a
  point in your code you can identify by reading it. <code>Dispose</code> is deterministic: it runs
  when you call it, and not otherwise.</p>

  <p class="define"><span class="define__term">IDisposable</span> The interface a type implements to
  say "I hold something that must be released, and here is the method to release it". A single
  method, <code>void Dispose()</code>.</p>

  <p class="define"><span class="define__term">Finaliser</span> A method — written
  <code>~TypeName()</code> — that the runtime calls before reclaiming an object's memory, if the
  object still needs it. Non-deterministic: you do not know when, on which thread, or in what order,
  and you have no guarantee it runs at all before the process exits.</p>

  <p>The division of labour is:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th></th><th><code>Dispose</code></th><th>Finaliser</th></tr>
      </thead>
      <tbody>
        <tr><td>When it runs</td><td>Exactly where you call it</td><td>Some time after the object becomes unreachable, or never</td></tr>
        <tr><td>Who calls it</td><td>You, or a <code>using</code></td><td>The runtime, on the finaliser thread</td></tr>
        <tr><td>Guaranteed to run?</td><td>Yes, if you wrote the <code>using</code></td><td><strong>No</strong> — not on abrupt process exit</td></tr>
        <tr><td>May touch managed objects?</td><td>Yes</td><td><strong>No</strong> — they may already be finalised</td></tr>
        <tr><td>Cost when not needed</td><td>None</td><td>An extra collection for every instance</td></tr>
        <tr><td>What it is for</td><td>Releasing anything, promptly</td><td>A last-resort net for unmanaged handles</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>An analogy, and its limits.</strong> Think of a library. Returning a book yourself is
  <code>Dispose</code>: it happens when you do it, and the next borrower gets it immediately. The
  finaliser is the librarian who, at some unspecified point, notices a book has been abandoned and
  shelves it. The book does come back. You cannot say when, and if the library closes for good with
  the book still on a table, it never comes back at all.</p>

  <p><strong>Where the analogy breaks:</strong> the librarian is triggered by shelf space running
  low, not by books being abandoned. A reader who abandons a thousand books without taking up any
  shelf space is never noticed. That is precisely the Ledger failure — handles leaked, memory did
  not, so nothing prompted the collector to look.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The default Windows limit is roughly 10,000 handles per process for many resource types, and
    Linux file-descriptor limits are commonly 1,024 or 4,096 per process unless raised. At the
    measured 1.00 handles per file, Ledger's archiver exhausted a 4,096 descriptor limit after about
    3,900 customers.</p>
    <p>The exception does not surface at the leaking line. It surfaces at whichever unrelated line
    next asks the OS for a handle — often a logging call or a health check — which is why the first
    three incident reports blamed the logger.</p>
  </div>
</section>

<section id="minimal-example">
  <h2>The smallest complete example</h2>

  <pre data-lang="csharp" data-net="10" data-title="06-minimal-example.cs"><code>// 06-minimal-example.cs — Dispose is deterministic. Finalisation is not. Nothing
// calls Dispose for you.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

Console.WriteLine("With using:");
using (var a = new Resource("A"))
{
    Console.WriteLine("  ...work...");
}
Console.WriteLine("  (disposed at the closing brace, every time, guaranteed)");
Console.WriteLine();

Console.WriteLine("Without using:");
Abandon();
Console.WriteLine("  ...work...");
Console.WriteLine($"  disposals so far: {Resource.Disposals}, finalisers so far: {Resource.Finalisers}");
Console.WriteLine();

Console.WriteLine("After forcing a collection:");
GC.Collect();
GC.WaitForPendingFinalizers();
Console.WriteLine($"  disposals: {Resource.Disposals}, finalisers: {Resource.Finalisers}");
Console.WriteLine();

Console.WriteLine("Dispose ran once, for the object in the using block.");
Console.WriteLine("The abandoned object was never disposed - only finalised, and only");
Console.WriteLine("because a collection happened to run. Nothing in the runtime calls");
Console.WriteLine("Dispose for you.");

static void Abandon()
{
    var b = new Resource("B");
}

sealed class Resource : IDisposable
{
    public static int Disposals;
    public static int Finalisers;

    private readonly string _name;
    private bool _disposed;

    public Resource(string name) =&gt; _name = name;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Interlocked.Increment(ref Disposals);
        Console.WriteLine($"  Dispose ran for {_name}");

        // Without this, the object still pays for an extra collection.
        GC.SuppressFinalize(this);
    }

    ~Resource() =&gt; Interlocked.Increment(ref Finalisers);
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>With using:
  ...work...
  Dispose ran for A
  (disposed at the closing brace, every time, guaranteed)

Without using:
  ...work...
  disposals so far: 1, finalisers so far: 0

After forcing a collection:
  disposals: 1, finalisers: 1

Dispose ran once, for the object in the using block.
The abandoned object was never disposed - only finalised, and only
because a collection happened to run. Nothing in the runtime calls
Dispose for you.</code></pre>

  <p>Read the middle block again. After the abandoned object went out of scope, <strong>disposals
  stayed at 1 and finalisers stayed at 0</strong>. The object was unreachable and nothing had
  happened to it. It took a forced collection to run the finaliser at all.</p>

  <p>In a real process that forced collection does not exist. The finaliser runs when the collector
  decides to run, which might be in a millisecond or might be never.</p>
</section>

<section id="using">
  <h2>What <code>using</code> actually compiles to</h2>

  <p class="define"><span class="define__term">using statement</span> The form with parentheses and a
  block. The compiler rewrites it into <code>try</code>/<code>finally</code> with a
  <code>Dispose</code> call in the <code>finally</code>.</p>

  <p class="define"><span class="define__term">using declaration</span> The form without parentheses
  — <code>using var x = ...;</code> — introduced in C# 8. It disposes at the end of the enclosing
  <em>scope</em> rather than at a brace you chose.</p>

  <pre data-lang="csharp" data-net="10"><code>// These two are the same code after compilation.

using (var connection = new SqlConnection(connectionString))
{
    connection.Open();
}

// becomes:

var connection = new SqlConnection(connectionString);
try
{
    connection.Open();
}
finally
{
    // A null check, because the expression may be null for a reference
    // type. Disposing null is a no-op rather than an exception.
    connection?.Dispose();
}</code></pre>

  <p>Three consequences follow directly from it being a <code>finally</code> block, and all three are
  worth being able to state:</p>

  <h3>1. Dispose runs when the body throws</h3>

  <pre data-lang="console" data-title="01-dispose-basics.cs"><code>4. Dispose runs even when the body throws

     open    throws
     dispose throws
     caught: something failed</code></pre>

  <p>The dispose line appears <em>before</em> the catch line. The <code>finally</code> runs while the
  exception is still propagating, before any handler further up sees it.</p>

  <h3>2. Nested resources dispose in reverse order</h3>

  <pre data-lang="console" data-title="01-dispose-basics.cs"><code>     open    outer
     open    middle
     open    inner
     all three open
     dispose inner
     dispose middle
     dispose outer</code></pre>

  <p>This is not cosmetic. A <code>StreamWriter</code> wrapping a <code>FileStream</code> must flush
  its buffer <em>through</em> the file stream before the file handle closes. Reverse order is what
  guarantees the inner one finishes with the outer one still usable.</p>

  <h3>3. A using declaration lives longer than people expect</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Holds every connection until the method returns"><code>public async Task ProcessAllAsync(IReadOnlyList&lt;int&gt; customerIds, CancellationToken ct)
{
    foreach (int id in customerIds)
    {
        // WRONG: a using declaration inside a loop body disposes at the end
        // of the ITERATION, which is correct here - but move it above the
        // loop by accident and you hold every connection open at once.
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(ct);
        await ProcessCustomerAsync(connection, id, ct);
    }
}</code></pre>

  <p>That version is in fact correct — the declaration is inside the loop body, so each iteration
  disposes its own. Measured:</p>

  <pre data-lang="console" data-title="01-dispose-basics.cs"><code>   in a loop, each iteration disposes its own:
     open    iteration-0
     dispose iteration-0
     open    iteration-1
     dispose iteration-1
     open    iteration-2
     dispose iteration-2</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>A <code>using</code> declaration at the top of a long method holds its resource until the
    method returns. That is the difference between holding a database connection for 2 ms and holding
    it for the whole request. With a connection pool of 100 and a 200 ms request, the second version
    caps you at 500 requests per second on pool exhaustion alone.</p>
    <p>When the scope is not visibly tight, use the block form. The extra braces document the
    lifetime.</p>
  </div>

  <h3>Dispose must be safe to call twice</h3>

  <pre data-lang="console" data-title="01-dispose-basics.cs"><code>     Dispose called 3 times, cleanup ran 1 time(s)</code></pre>

  <p>This is a requirement of the interface contract, not a courtesy. Code that both wraps an object
  in a <code>using</code> and disposes it by hand is common, and it must not throw. The guard is one
  field:</p>

  <pre data-lang="csharp" data-net="10"><code>public void Dispose()
{
    if (_disposed)
    {
        return;
    }

    _disposed = true;
    _handle.Close();
}</code></pre>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Calling a method other than <code>Dispose</code> on a disposed object should throw
    <code>ObjectDisposedException</code>, and .NET 8 added a helper for it:
    <code>ObjectDisposedException.ThrowIf(_disposed, this)</code>.</p>
    <p><code>Dispose</code> itself is the exception to that rule — it must stay silent.</p>
  </div>
</section>

<section id="finalisers">
  <h2>Finalisers, and what they cost</h2>

  <p class="define"><span class="define__term">Finalisation queue</span> A list the runtime keeps of
  every live object whose type declares a finaliser. An object is put on it at allocation, not at
  death.</p>

  <p class="define"><span class="define__term">Finaliser thread</span> A single dedicated thread per
  process that runs queued finalisers, one at a time.</p>

  <h3>The extra collection</h3>

  <p>When a collection finds a finalisable object unreachable, it cannot reclaim it — the finaliser
  has not run yet, and the finaliser needs the object to exist. So the collector <strong>promotes it
  and moves it to a ready-to-run queue</strong>. Only a later collection, after the finaliser has
  run, reclaims the memory.</p>

  <pre data-lang="console" data-title="02-finalisers.cs"><code>1. A finaliser costs an extra collection

   allocated 1,000 finalisable objects, 1,000 plain ones
   finalised so far                    : 0

   after collection 1                  : 0 finalised
     (the collection found them unreachable and QUEUED them,
      promoting each one to survive this collection)

   after WaitForPendingFinalizers      : 1000 finalised
     (the finaliser thread has now run them, but the MEMORY is
      still there - finalising is not collecting)

   after collection 2                  : memory reclaimed</code></pre>

  <p>Three steps to reclaim what a plain object gives back in one. Measured at scale, with a single
  collection and no draining of the queue:</p>

  <pre data-lang="console" data-title="02-finalisers.cs"><code>   200,000 objects of each kind, then ONE collection:

     without a finaliser :         0 KB still held
     with a finaliser    :     2,459 KB still held</code></pre>

  <p>Both sets became unreachable at the same instant. The plain objects were gone; the finalisable
  ones were promoted into the queue. That cost applies to <strong>every instance of a type that
  declares a finaliser, whether or not the finaliser does anything useful.</strong></p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>No ratio is quoted for those two figures on purpose. The plain measurement rounds to zero, so
    any ratio against it is an artefact of dividing by a near-zero baseline rather than a real
    multiple. The claim is the absolute retention: 2.4 to 3.0 MB across runs, against nothing.</p>
  </div>

  <h3><code>SuppressFinalize</code> is what buys the cost back</h3>

  <pre data-lang="csharp" data-net="10" data-title="02-finalisers.cs"><code>sealed class ProperDisposePattern : IDisposable
{
    private bool _disposed;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        ReleaseUnmanaged();

        // Tell the collector the finaliser is no longer needed. Without this
        // line the object still pays the two-collection cost.
        GC.SuppressFinalize(this);
    }

    ~ProperDisposePattern()
    {
        Counter.Increment();
        ReleaseUnmanaged();
    }

    private void ReleaseUnmanaged()
    {
        // A real class would close a handle here.
    }
}</code></pre>

  <pre data-lang="console" data-title="02-finalisers.cs"><code>   1,000 objects, all disposed properly
   finalisers that ran                 : 0

   1,000 objects, none disposed
   finalisers that ran                 : 1000</code></pre>

  <p><code>GC.SuppressFinalize(this)</code> removes the object from the finalisation queue. Having
  released the resource in <code>Dispose</code>, there is nothing for the finaliser to do, and
  suppressing it returns the object to single-collection behaviour.</p>

  <p><strong>Forgetting that one line means paying the two-collection cost even for objects you
  disposed correctly.</strong> It is the most common omission in a hand-written dispose pattern.</p>

  <h3>Order is not guaranteed</h3>

  <pre data-lang="console" data-title="02-finalisers.cs"><code>   created in order  : A, B, C, D, E
   finalised in order: D, C, B, A, E</code></pre>

  <p>Not creation order, not reverse creation order. That result was stable across every run measured
  here, which makes it more dangerous rather than less — a reproducible order invites code that
  depends on it, and nothing guarantees it across runtimes or versions.</p>

  <p>The rule that follows is absolute: <strong>a finaliser must only release unmanaged resources the
  object owns directly.</strong> It must never call a method on another managed object, because that
  object may already have been finalised.</p>

  <h3>Which thread, and what happens if it stops</h3>

  <pre data-lang="console" data-title="02-finalisers.cs"><code>   creating thread id  : 2
   finalising thread id: 1
   same thread?        : False</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>There is <strong>one finaliser thread for the entire process</strong>, and everything queued
    runs on it, one at a time. Two consequences cause real incidents:</p>
    <ul>
      <li>A slow finaliser blocks every other finaliser in the process. One that blocks on a lock, or
      waits on a task that never completes, hangs the finaliser thread <em>permanently</em> — and
      then memory for every finalisable object in the process is never reclaimed.</li>
      <li>An unhandled exception in a finaliser <strong>terminates the process</strong>. There is no
      catch block anywhere above it. A finaliser must not throw, ever.</li>
    </ul>
  </div>

  <h3>When you actually need one</h3>

  <p>Almost never. The honest guidance:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Finaliser?</th></tr>
      </thead>
      <tbody>
        <tr><td>Your class holds other <code>IDisposable</code> objects</td><td><strong>No.</strong> Implement <code>IDisposable</code>, dispose them, no finaliser.</td></tr>
        <tr><td>Your class holds a <code>SafeHandle</code></td><td><strong>No.</strong> <code>SafeHandle</code> has its own finaliser and does it better.</td></tr>
        <tr><td>Your class holds only managed state</td><td><strong>No.</strong> There is nothing to finalise.</td></tr>
        <tr><td>Your class holds a raw <code>IntPtr</code> from native code</td><td>Wrap it in a <code>SafeHandle</code> instead. Then no.</td></tr>
        <tr><td>You genuinely cannot use <code>SafeHandle</code></td><td>Yes — and this is the only case.</td></tr>
      </tbody>
    </table>
  </div>

  <p class="define"><span class="define__term">SafeHandle</span> An abstract base class wrapping a
  native handle, with a correct finaliser, reference counting to prevent the handle being closed
  while in use, and protection against handle-recycling attacks. Every handle-owning type in the BCL
  uses one.</p>

  <p>If you write a finaliser and a <code>SafeHandle</code> would have worked, you have written a
  worse version of code that already exists.</p>
</section>

<section id="the-pattern">
  <h2>The dispose pattern, and when the simple version is enough</h2>

  <p class="define"><span class="define__term">The dispose pattern</span> The canonical shape for a
  class that may be inherited from: a public <code>Dispose()</code>, a
  <code>protected virtual Dispose(bool disposing)</code> that derived classes override, and a
  finaliser calling it with <code>false</code>.</p>

  <p>Most classes do not need it. <strong>Start here</strong> — a sealed class holding disposable
  fields, which is the overwhelmingly common case:</p>

  <pre data-lang="csharp" data-net="10" data-title="The version you will write 95% of the time"><code>public sealed class InvoiceExporter : IDisposable
{
    private readonly FileStream _output;
    private readonly StreamWriter _writer;
    private bool _disposed;

    public InvoiceExporter(string path)
    {
        _output = new FileStream(path, FileMode.Create, FileAccess.Write);
        _writer = new StreamWriter(_output);
    }

    public void Write(Invoice invoice)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _writer.WriteLine($"{invoice.Number},{invoice.AmountMinor}");
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // Reverse order: the writer flushes THROUGH the stream, so it must
        // finish before the stream closes.
        _writer.Dispose();
        _output.Dispose();
    }
}

public sealed record Invoice(string Number, long AmountMinor);</code></pre>

  <p><strong>Sealed, no finaliser, no <code>SuppressFinalize</code>.</strong> There is no finaliser to
  suppress and no derived class to accommodate. Adding either would be cargo cult.</p>

  <h3>The full pattern, for an unsealed class</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-exercises.cs"><code>class BaseResource : IDisposable
{
    private bool _disposed;

    public void Dispose()
    {
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }

    // protected virtual so derived classes extend cleanup rather than replace it.
    protected virtual void Dispose(bool disposing)
    {
        if (_disposed)
        {
            return;
        }

        if (disposing)
        {
            // Managed cleanup. Only safe when called from Dispose(), because
            // during finalisation these objects may already be finalised.
            Log.Add("base: managed cleanup");
        }

        // Unmanaged cleanup. Safe from either path.
        Log.Add("base: unmanaged cleanup");
        _disposed = true;
    }

    ~BaseResource() =&gt; Dispose(disposing: false);
}

sealed class DerivedResource : BaseResource
{
    private bool _disposed;

    protected override void Dispose(bool disposing)
    {
        if (!_disposed)
        {
            if (disposing)
            {
                Log.Add("derived: managed cleanup");
            }

            Log.Add("derived: unmanaged cleanup");
            _disposed = true;
        }

        // Base LAST, so the derived class cleans up before the state it
        // may depend on is gone.
        base.Dispose(disposing);
    }
}</code></pre>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   order of cleanup:
     derived: managed cleanup
     derived: unmanaged cleanup
     base: managed cleanup
     base: unmanaged cleanup

   the same type abandoned without Dispose:
     derived: unmanaged cleanup
     base: unmanaged cleanup</code></pre>

  <p>Two things that output proves.</p>

  <p><strong>The derived class cleans up before the base.</strong> That is what calling
  <code>base.Dispose(disposing)</code> <em>last</em> inside the override gives you, and it matters
  because the derived class may depend on base state.</p>

  <p><strong>On the finalisation path, the managed cleanup did not run.</strong> That is the entire
  purpose of the <code>disposing</code> parameter. When it is <code>false</code> the call came from
  the finaliser, and the managed objects this class references may already have been finalised —
  touching them is undefined behaviour.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>The <code>disposing</code> parameter is badly named and it is the reason this pattern is
    misremembered. It does not mean "am I disposing". It means <strong>"is it safe to touch other
    managed objects"</strong>, which is true only when a human called <code>Dispose</code>.</p>
    <p>Read it as <code>calledFromDispose</code> and the pattern stops being mysterious.</p>
  </div>

  <h3>Ownership: dispose what you created</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   shared object disposed 0 time(s) by its borrowers
   after the OWNER disposes it: 1 time(s)</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Disposes something it does not own"><code>public sealed class PaymentClient : IDisposable
{
    private readonly HttpClient _http;

    // The HttpClient arrives through the constructor. This class did not
    // create it and does not own it.
    public PaymentClient(HttpClient http) =&gt; _http = http;

    public void Dispose()
    {
        // WRONG. In ASP.NET Core this HttpClient is managed by
        // IHttpClientFactory and shared. Disposing it here breaks every
        // other consumer, and the symptom is ObjectDisposedException on an
        // unrelated request minutes later.
        _http.Dispose();
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Owns nothing, so disposes nothing"><code>public sealed class PaymentClient
{
    private readonly HttpClient _http;

    public PaymentClient(HttpClient http) =&gt; _http = http;

    // No IDisposable at all. This class holds a borrowed reference and has
    // nothing of its own to release. The container disposes what it created.
    public Task&lt;HttpResponseMessage&gt; ChargeAsync(Uri uri, CancellationToken ct) =&gt;
        _http.GetAsync(uri, ct);
}</code></pre>

  <p>The rule: <strong>dispose what you created; do not dispose what you were given.</strong> A class
  handed a dependency through its constructor does not own it, and the dependency injection container
  will dispose what it built.</p>
</section>

<section id="async-disposal">
  <h2><code>IAsyncDisposable</code> and <code>await using</code></h2>

  <p class="define"><span class="define__term">IAsyncDisposable</span> The asynchronous counterpart to
  <code>IDisposable</code>, with a single method <code>ValueTask DisposeAsync()</code>. It exists
  because closing a resource can require I/O — flushing a buffer to a socket, committing a
  transaction, sending a close frame — and doing that synchronously blocks a thread.</p>

  <p class="define"><span class="define__term">await using</span> The disposal form that awaits
  <code>DisposeAsync</code>. Same reverse ordering and same <code>finally</code> semantics as
  <code>using</code>; the difference is that it yields the thread while the resource closes.</p>

  <h3>The trap: both interfaces on one type</h3>

  <pre data-lang="console" data-title="03-async-disposable.cs"><code>   await using:
     body
     DisposeAsync ran for a

   plain using (no await):
     body
     Dispose (synchronous) ran for b</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>The second version compiled with <strong>no warning at all</strong>. On a type where
    <code>DisposeAsync</code> flushes a buffer over the network and <code>Dispose</code> does not,
    that is silent data loss — the code is correct-looking, compiles clean, and drops writes.</p>
    <p>There is no compiler diagnostic for this. The only defence is a review habit: <strong>if a type
    has <code>DisposeAsync</code>, the <code>using</code> must be awaited.</strong> This applies to
    <code>DbContext</code>, <code>SqlConnection</code>, <code>FileStream</code>, and every pooled
    connection type.</p>
  </div>

  <h3>What async disposal does and does not buy you</h3>

  <pre data-lang="console" data-title="03-async-disposable.cs"><code>   50 resources, 4 ms of I/O to close each
     Dispose (blocks the thread)  :     809 ms
     DisposeAsync (yields)        :     781 ms</code></pre>

  <p><strong>The wall clock is essentially the same, and that is the most commonly misread result in
  this area.</strong> Both wait the same 4 ms per resource. Async disposal is not faster.</p>

  <p>The difference is what the thread does while waiting. The blocking version occupies a thread-pool
  thread for the entire close. Under load, disposal competes for threads with request handling — which
  is how a slow database close turns into thread-pool starvation, a symptom that looks nothing like a
  disposal problem.</p>

  <h3>Disposal is sequential, not parallel</h3>

  <pre data-lang="console" data-title="03-async-disposable.cs"><code>     dispose inner (async)
     dispose middle (async)
     dispose outer (async)</code></pre>

  <p>Each <code>DisposeAsync</code> is awaited before the next begins. Three resources taking 20 ms
  each to close cost 60 ms, not 20. Nested <code>await using</code> does not parallelise shutdown, and
  a service holding several slow-closing resources pays the sum on every request.</p>

  <h3>Shutting down something with a background loop</h3>

  <pre data-lang="csharp" data-net="10" data-title="05-exercises.cs"><code>sealed class BackgroundWorker : IAsyncDisposable
{
    public static bool LoopCompleted;

    private readonly CancellationTokenSource _cts = new();
    private readonly System.Collections.Concurrent.ConcurrentQueue&lt;int&gt; _queue = new();
    private readonly Task _loop;
    private int _processed;

    public BackgroundWorker()
    {
        LoopCompleted = false;
        _loop = RunAsync(_cts.Token);
    }

    public int Processed =&gt; Volatile.Read(ref _processed);

    public void Enqueue(int item) =&gt; _queue.Enqueue(item);

    private async Task RunAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                if (_queue.TryDequeue(out _))
                {
                    Interlocked.Increment(ref _processed);
                }

                await Task.Delay(2, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown.
        }
        finally
        {
            LoopCompleted = true;
        }
    }

    public async ValueTask DisposeAsync()
    {
        // 1. Ask the loop to stop.
        await _cts.CancelAsync().ConfigureAwait(false);

        // 2. WAIT for it. Without this the caller believes shutdown finished
        //    while the loop is still running.
        try
        {
            await _loop.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }

        // 3. Dispose what this object created.
        _cts.Dispose();
    }
}</code></pre>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   items processed before shutdown : 5
   DisposeAsync completed in       : 84 ms
   loop actually finished          : True</code></pre>

  <p>Three steps, all required:</p>

  <ol>
    <li>Signal cancellation, so the loop knows to stop.</li>
    <li><strong>Await the loop task</strong>, so shutdown does not race the work.</li>
    <li>Dispose the <code>CancellationTokenSource</code> this object created.</li>
  </ol>

  <p>Skipping step 2 is the common bug, and the measured line <code>loop actually finished: True</code>
  is what proves it was not skipped. Without the await, <code>DisposeAsync</code> returns, the caller
  believes shutdown is complete, and the loop is still running against objects being torn down around
  it.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. Disposal that throws, hiding the real failure</h3>

  <pre data-lang="console" data-title="03-async-disposable.cs"><code>     body threw, and we caught: IOException: the connection could not be flushed</code></pre>

  <p>The body threw <code>InvalidOperationException("the body failed")</code>. That exception is
  <strong>gone</strong>. The disposal exception replaced it, because it was thrown from the
  <code>finally</code> while the first was still propagating.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Destroys the diagnostic information"><code>public async ValueTask DisposeAsync()
{
    // WRONG: if the connection is already broken, this throws - and
    // whatever real failure caused it to break is erased from the logs.
    await _connection.FlushAsync();
    await _connection.DisposeAsync();
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Log it, never propagate it"><code>public async ValueTask DisposeAsync()
{
    if (_disposed)
    {
        return;
    }

    _disposed = true;

    try
    {
        await _connection.FlushAsync().ConfigureAwait(false);
    }
    catch (IOException ex)
    {
        // Record it, but never let disposal throw: the exception the caller
        // is already handling matters more than this one.
        _logger.LogWarning(ex, "Flush failed during disposal; connection was already broken");
    }
    finally
    {
        await _connection.DisposeAsync().ConfigureAwait(false);
    }
}</code></pre>

  <h3>2. The event subscription that keeps everything alive</h3>

  <pre data-lang="console" data-title="05-exercises.cs"><code>   subscribed without unsubscribing : 5,000 of 5,000 still alive
   unsubscribed in Dispose          : 0 of 5,000 still alive</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Never collectable"><code>public sealed class RateWatcher
{
    // WRONG: subscribes to a static event and never unsubscribes. Every
    // instance is reachable from a GC root forever. Measured: 5,000 of
    // 5,000 still alive after a full collection.
    public RateWatcher() =&gt; ExchangeRates.Updated += OnRatesUpdated;

    private void OnRatesUpdated(object? sender, EventArgs e)
    {
    }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Disposable because it subscribed"><code>public sealed class RateWatcher : IDisposable
{
    private bool _disposed;

    public RateWatcher() =&gt; ExchangeRates.Updated += OnRatesUpdated;

    private void OnRatesUpdated(object? sender, EventArgs e)
    {
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        ExchangeRates.Updated -= OnRatesUpdated;
    }
}</code></pre>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>This is the case where <code>IDisposable</code> is about <strong>memory</strong> rather than
    handles, and where a finaliser would be no help whatsoever. The object is not eligible for
    finalisation, because it is not garbage — the event holds a live reference to it.</p>
    <p>The rule: <strong>if a constructor subscribes to something, the class is
    <code>IDisposable</code>.</strong> No exceptions.</p>
  </div>

  <h3>3. Relying on the finaliser</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="The Ledger archiver, as it shipped"><code>foreach (Statement statement in statements)
{
    // WRONG: no using. The finaliser will close it eventually - but the
    // finaliser runs on a garbage collection, and collections are triggered
    // by MEMORY. This loop allocates almost nothing, so no collection is
    // triggered, so the handles are never returned.
    var stream = new FileStream(statement.Path, FileMode.Create, FileAccess.Write);
    var writer = new StreamWriter(stream);
    writer.Write(statement.Content);
    writer.Flush();
}</code></pre>

  <h3>4. Async void disposal</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Fire and forget, during teardown"><code>public sealed class SessionCache : IDisposable
{
    // WRONG on two counts. Dispose returns immediately, so the caller
    // believes cleanup finished when it has not started. And an exception
    // inside an async void method cannot be caught by the caller - it goes
    // straight to the unhandled exception handler and kills the process.
    public async void Dispose()
    {
        await _connection.CloseAsync();
    }
}</code></pre>

  <p>If disposal needs to await, the type implements <code>IAsyncDisposable</code>. There is no third
  option.</p>

  <h3>5. Disposing a <code>Task</code>, and other cargo cult</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Pointless, and occasionally harmful"><code>// Task implements IDisposable, but disposing it has been unnecessary
// since .NET 4.5 - it only ever released a WaitHandle that is now
// allocated lazily and almost never exists.
using (var task = DoWorkAsync())
{
    await task;
}</code></pre>

  <p>Related cases where <code>IDisposable</code> exists but disposal is not required:
  <code>Task</code>, <code>CancellationTokenSource</code> that has already been cancelled and has no
  registrations (disposal is still good practice, and cheap), and <code>MemoryStream</code>, whose
  <code>Dispose</code> only marks it closed. Knowing which is which matters less than knowing that
  <code>using</code> on any of them is harmless — <strong>when in doubt, dispose.</strong></p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p><strong>Symptom:</strong> <code>IOException</code> or "too many open files", or
    <code>ObjectDisposedException</code> on an object you did not dispose, or memory that grows while
    the collector says the heap is flat.</p>
    <p><strong>Tools:</strong> handle counters first, then a dump for the finalisation queue, then
    the analysers that catch this at build time.</p>
  </div>

  <h3>Step 1: is it handles or memory?</h3>

  <pre data-lang="bash" data-title="The counters that separate the two"><code>dotnet-counters monitor --process-id 4821 --counters System.Runtime</code></pre>

  <p>A handle leak shows <strong>flat GC Heap Size with a climbing working set and a climbing handle
  count</strong>. A memory leak shows a climbing GC Heap Size. They need completely different
  investigations, and this is the cheapest way to tell them apart.</p>

  <p>Handle count is not in the .NET counters — read it from the OS:</p>

  <pre data-lang="bash" data-title="Windows, then Linux"><code>Get-Process -Id 4821 | Select-Object HandleCount

ls /proc/4821/fd | wc -l
cat /proc/4821/limits | grep "open files"</code></pre>

  <p>Or from inside the process, which is worth exposing on a health endpoint:</p>

  <pre data-lang="csharp" data-net="10" data-title="Worth logging on a timer"><code>using System.Diagnostics;

using Process current = Process.GetCurrentProcess();
current.Refresh();

_logger.LogInformation(
    "handles={Handles} threads={Threads} workingSetMb={WorkingSetMb} heapMb={HeapMb}",
    current.HandleCount,
    current.Threads.Count,
    current.WorkingSet64 / 1024 / 1024,
    GC.GetTotalMemory(false) / 1024 / 1024);</code></pre>

  <h3>Step 2: find the undisposed objects in a dump</h3>

  <pre data-lang="bash"><code>dotnet-dump collect --process-id 4821 --output ledger.dmp
dotnet-dump analyze ledger.dmp</code></pre>

  <pre data-lang="text" data-title="At the SOS prompt"><code>&gt; finalizequeue
&gt; dumpheap -type FileStream
&gt; dumpheap -type SafeFileHandle
&gt; gcroot 00007f2a1c004080</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Command</th><th>What it answers</th></tr>
      </thead>
      <tbody>
        <tr><td><code>finalizequeue</code></td><td>Every object waiting to be finalised, grouped by type. A large count of one type is a leak of that type. A queue that never drains means the finaliser thread is stuck.</td></tr>
        <tr><td><code>dumpheap -type FileStream</code></td><td>How many streams exist. Compare against how many you expect to be open at once.</td></tr>
        <tr><td><code>gcroot &lt;address&gt;</code></td><td>Why one object is still alive. For the event-subscription leak this points straight at the event's delegate list.</td></tr>
        <tr><td><code>threads</code> then <code>clrstack</code></td><td>What the finaliser thread is doing. If it is blocked, everything finalisable in the process is stuck behind it.</td></tr>
      </tbody>
    </table>
  </div>

  <h3>Step 3: let the compiler find them instead</h3>

  <p>Most of this module is caught at build time by analysers that are not on by default:</p>

  <pre data-lang="xml" data-title="Directory.Build.props"><code>&lt;Project&gt;
  &lt;PropertyGroup&gt;
    &lt;AnalysisMode&gt;Recommended&lt;/AnalysisMode&gt;
    &lt;EnableNETAnalyzers&gt;true&lt;/EnableNETAnalyzers&gt;

    &lt;!-- Promote the disposal rules to errors. Every one of them
         corresponds to a failure mode in this module. --&gt;
    &lt;WarningsAsErrors&gt;$(WarningsAsErrors);CA1063;CA1816;CA2000;CA2213;CA1001&lt;/WarningsAsErrors&gt;
  &lt;/PropertyGroup&gt;
&lt;/Project&gt;</code></pre>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Rule</th><th>Catches</th></tr>
      </thead>
      <tbody>
        <tr><td>CA1001</td><td>A type owning disposable fields that does not implement <code>IDisposable</code>.</td></tr>
        <tr><td>CA2213</td><td>A disposable field that <code>Dispose</code> never disposes.</td></tr>
        <tr><td>CA2000</td><td>An object created and not disposed before going out of scope — this is the Ledger bug.</td></tr>
        <tr><td>CA1816</td><td><code>Dispose</code> that does not call <code>GC.SuppressFinalize</code>.</td></tr>
        <tr><td>CA1063</td><td>The dispose pattern implemented incorrectly on an unsealed class.</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>CA2000 would have caught the Ledger incident at build time, two years before it
  fired.</strong> It is off by default because it produces false positives on ownership transfer,
  which is a real cost — but a much smaller one than a nightly job failing in production.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The garbage collector calls Dispose when it collects the object."</strong></p>
    <p>It does not, and nothing does. Measured: 1,000 objects abandoned without disposal produced
    <strong>zero</strong> disposals after a full collection and finalisation. The collector reclaims
    memory; it has no concept of your <code>Dispose</code> method.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Adding a finaliser is a cheap safety net."</strong></p>
    <p>It costs an extra collection for <em>every instance of the type</em>, whether or not the
    finaliser ever runs. Measured: 200,000 finalisable objects still held 2.4 MB after a collection
    that reclaimed the equivalent plain objects entirely.</p>
    <p>It also risks hanging the single process-wide finaliser thread and terminating the process if
    it throws. If you hold a <code>SafeHandle</code>, you already have the safety net.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"await using is faster than using."</strong></p>
    <p>Measured at 781 ms against 809 ms for the same 50 closes — essentially identical, and async
    disposal is sometimes marginally slower. Wall clock is not the point.</p>
    <p>The benefit is that the thread is released while the close happens, so disposal stops
    competing with request handling for the thread pool.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Every disposable class needs the full dispose pattern."</strong></p>
    <p>A sealed class holding disposable fields needs a <code>Dispose</code> method, a
    <code>_disposed</code> guard, and nothing else. No <code>protected virtual</code>, no finaliser,
    no <code>SuppressFinalize</code> — there is no finaliser to suppress and no derived class to
    accommodate.</p>
    <p>The full pattern exists for unsealed classes that directly own unmanaged handles, which is a
    small and shrinking category.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"I should dispose everything I have a reference to."</strong></p>
    <p>Dispose what you <em>created</em>. Measured: two consumers handed the same instance disposed it
    zero times between them, and the owner disposed it once. A class disposing an injected
    <code>HttpClient</code> breaks every other consumer of it, and the symptom appears on an unrelated
    request minutes later.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"A finaliser and Dispose do the same thing, so I can put the logic in one place and
    call it from both."</strong></p>
    <p>They must do different things, which is exactly what the <code>disposing</code> parameter
    encodes. On the finalisation path you must not touch other managed objects — measured, the managed
    cleanup correctly did not run — because finalisation order is not guaranteed and those objects may
    already be finalised.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger's archiver leaked exactly 1.00 handles per statement. With 4,000 customers and a
    default file-descriptor limit of 4,096, it failed roughly 3,900 statements in — about twenty
    minutes.</p>
    <p>It survived two years because the customer count was under the limit. The code did not change;
    the business grew. That is the signature of a resource leak: <strong>it is a capacity bug that
    presents as a sudden, total failure</strong> rather than as gradual degradation.</p>
    <p>Forcing a collection recovered exactly 400 of 400 leaked handles, which is what makes this
    class of bug so persistent — every diagnostic that involves attaching a debugger or taking a dump
    triggers a collection and makes the evidence disappear.</p>
  </div>

  <p>The decisions this module should let you make without looking anything up:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Question</th><th>Answer</th></tr>
      </thead>
      <tbody>
        <tr><td>My class holds disposable fields</td><td>Implement <code>IDisposable</code>, seal it, dispose them in reverse order. No finaliser.</td></tr>
        <tr><td>My class subscribes to an event</td><td>Implement <code>IDisposable</code> and unsubscribe. It is a memory leak otherwise.</td></tr>
        <tr><td>My class starts a background task</td><td>Implement <code>IAsyncDisposable</code>: cancel, <strong>await the task</strong>, dispose the source.</td></tr>
        <tr><td>My class was given a dependency</td><td>Do not dispose it. You do not own it.</td></tr>
        <tr><td>My cleanup needs to await</td><td><code>IAsyncDisposable</code>. Never <code>async void Dispose</code>.</td></tr>
        <tr><td>A type offers both interfaces</td><td><code>await using</code>. The plain form compiles silently and takes the wrong path.</td></tr>
        <tr><td>My class holds a native handle</td><td>Wrap it in a <code>SafeHandle</code>. Then you need no finaliser.</td></tr>
        <tr><td>I want a safety net for a leak</td><td>Fix the leak. Turn on CA2000. The finaliser is not a substitute.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>This method compiles and runs. What is wrong with it, and what does the symptom look like in
    production?</p>
    <pre data-lang="csharp" data-net="10"><code>public string ReadHeader(string path)
{
    var reader = new StreamReader(path);
    return reader.ReadLine() ?? string.Empty;
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p>The <code>StreamReader</code> is never disposed, so the file handle is held until a garbage
        collection runs the finaliser on the underlying <code>SafeFileHandle</code>.</p>
        <p><strong>The symptom is not what you would guess.</strong> It is not an exception at this
        line. It is one of:</p>
        <ul>
          <li><code>IOException</code> at some unrelated line that next asks for a handle.</li>
          <li>"The process cannot access the file because it is being used by another process" when
          something later tries to delete or rewrite that file — the handle is still open.</li>
          <li>Nothing at all, for months, until call volume rises.</li>
        </ul>
        <pre data-lang="csharp" data-net="10"><code>public string ReadHeader(string path)
{
    using var reader = new StreamReader(path);
    return reader.ReadLine() ?? string.Empty;
}</code></pre>
        <p>Or, for this specific case, let the BCL do it:</p>
        <pre data-lang="csharp" data-net="10"><code>public string ReadHeader(string path) =&gt;
    File.ReadLines(path).FirstOrDefault() ?? string.Empty;</code></pre>
        <p>Analyser rule <strong>CA2000</strong> catches this at build time.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
      <span class="pill pill--easy">Easy</span></div>
    <p>A type implements both <code>IDisposable</code> and <code>IAsyncDisposable</code>. Which method
    runs for each of these, and which is the bug?</p>
    <pre data-lang="csharp" data-net="10"><code>using (var a = new Connection()) { }
await using (var b = new Connection()) { }
using var c = new Connection();
await using var d = new Connection();</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><code>a</code> and <code>c</code> call <strong><code>Dispose</code></strong>.
        <code>b</code> and <code>d</code> call <strong><code>DisposeAsync</code></strong>.</p>
        <p>Measured:</p>
        <pre data-lang="console"><code>   await using:
     DisposeAsync ran for a

   plain using (no await):
     Dispose (synchronous) ran for b</code></pre>
        <p><strong><code>a</code> and <code>c</code> are the bugs</strong>, and the compiler emits no
        warning for either. If <code>DisposeAsync</code> flushes a buffer over the network and
        <code>Dispose</code> does not, those two lines silently lose data.</p>
        <p>The rule: if a type has <code>DisposeAsync</code>, always <code>await using</code>. This
        applies to <code>DbContext</code>, <code>SqlConnection</code>, and every pooled connection
        type — all of which implement both.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Should this class implement <code>IDisposable</code>? If so, write it.</p>
    <pre data-lang="csharp" data-net="10"><code>public sealed class ExchangeRateCache
{
    private readonly HttpClient _http;
    private readonly Timer _refreshTimer;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Dictionary&lt;string, decimal&gt; _rates = new();

    public ExchangeRateCache(HttpClient http)
    {
        _http = http;
        _refreshTimer = new Timer(_ =&gt; _ = RefreshAsync(), null,
            TimeSpan.Zero, TimeSpan.FromMinutes(5));
    }

    private async Task RefreshAsync()
    {
        await _gate.WaitAsync();
        try
        {
            _rates = await _http.GetFromJsonAsync&lt;Dictionary&lt;string, decimal&gt;&gt;("/rates")
                     ?? _rates;
        }
        finally
        {
            _gate.Release();
        }
    }
}</code></pre>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Yes — and it should implement <code>IAsyncDisposable</code>, not
        <code>IDisposable</code>.</strong></p>
        <p>Work out ownership field by field, which is the general method:</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Field</th><th>Created here?</th><th>Dispose it?</th></tr></thead>
            <tbody>
              <tr><td><code>_http</code></td><td>No — injected</td><td><strong>No.</strong> Owned by the container or <code>IHttpClientFactory</code>.</td></tr>
              <tr><td><code>_refreshTimer</code></td><td>Yes</td><td><strong>Yes</strong>, and this is the urgent one — a live timer keeps this object alive and fires callbacks during teardown.</td></tr>
              <tr><td><code>_gate</code></td><td>Yes</td><td><strong>Yes.</strong></td></tr>
              <tr><td><code>_rates</code></td><td>Yes</td><td>No — plain managed memory, nothing to release.</td></tr>
            </tbody>
          </table>
        </div>
        <p><code>Timer</code> implements <code>IAsyncDisposable</code>, and its
        <code>DisposeAsync</code> is the only way to <em>wait</em> for a callback already in flight.
        That is why the async form is required rather than preferred:</p>
        <pre data-lang="csharp" data-net="10"><code>public sealed class ExchangeRateCache : IAsyncDisposable
{
    private readonly HttpClient _http;
    private readonly Timer _refreshTimer;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Dictionary&lt;string, decimal&gt; _rates = new();
    private bool _disposed;

    public ExchangeRateCache(HttpClient http)
    {
        _http = http;
        _refreshTimer = new Timer(_ =&gt; _ = RefreshAsync(), null,
            TimeSpan.Zero, TimeSpan.FromMinutes(5));
    }

    private async Task RefreshAsync()
    {
        if (_disposed)
        {
            return;
        }

        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            _rates = await _http.GetFromJsonAsync&lt;Dictionary&lt;string, decimal&gt;&gt;("/rates")
                         .ConfigureAwait(false)
                     ?? _rates;
        }
        catch (HttpRequestException)
        {
            // Keep the previous rates rather than propagating from a timer
            // callback, where nothing can catch it.
        }
        finally
        {
            _gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // AWAIT the timer's disposal: this is what waits for a callback that
        // is already running. Timer.Dispose() would return immediately and
        // let the callback keep going against a disposed semaphore.
        await _refreshTimer.DisposeAsync().ConfigureAwait(false);

        // Only now is it safe: nothing can still be inside RefreshAsync.
        _gate.Dispose();

        // Not disposed: injected, not owned.
        // _http
    }
}</code></pre>
        <p><strong>The ordering is the answer.</strong> Disposing <code>_gate</code> before awaiting
        the timer produces <code>ObjectDisposedException</code> inside a timer callback, on a thread
        with no handler — which in a background callback can terminate the process.</p>
        <p>Analyser rules <strong>CA1001</strong> and <strong>CA2213</strong> both flag the original.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
      <span class="pill pill--medium">Medium</span></div>
    <p>Memory grows steadily. A dump shows 400,000 live <code>OrderView</code> objects. Nothing in the
    application code references them, and <code>gcroot</code> on one of them ends at a static field on
    a class called <code>MarketFeed</code>. What is the bug, and why would adding a finaliser to
    <code>OrderView</code> not help?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>The bug is an event subscription that is never removed.</strong>
        <code>MarketFeed</code> has a static event; every <code>OrderView</code> subscribed in its
        constructor; the event's delegate list holds a reference to each one.</p>
        <p>Measured on exactly this shape:</p>
        <pre data-lang="console"><code>   subscribed without unsubscribing : 5,000 of 5,000 still alive
   unsubscribed in Dispose          : 0 of 5,000 still alive</code></pre>
        <p><strong>A finaliser would not help, and the reason is the useful part.</strong> A finaliser
        runs when an object is unreachable. These objects <em>are reachable</em> — from a static
        field, which is a GC root. They are not garbage, so they are never eligible for finalisation.
        The finaliser would never run.</p>
        <p>The fix is to unsubscribe, which makes the class disposable:</p>
        <pre data-lang="csharp" data-net="10"><code>public sealed class OrderView : IDisposable
{
    private bool _disposed;

    public OrderView() =&gt; MarketFeed.PriceChanged += OnPriceChanged;

    private void OnPriceChanged(object? sender, PriceChangedEventArgs e)
    {
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        MarketFeed.PriceChanged -= OnPriceChanged;
    }
}

public sealed class PriceChangedEventArgs : EventArgs
{
    public required string Symbol { get; init; }
    public required decimal Price { get; init; }
}</code></pre>
        <p><strong>The diagnostic rule worth keeping:</strong> if <code>gcroot</code> ends at a static
        field, you are looking at an event subscription, a static cache, or a static collection.
        Those three account for nearly every managed memory leak in .NET.</p>
        <p>Note also that a <code>-=</code> requires the same method reference. Subscribing with a
        lambda that captures state gives you nothing to unsubscribe with, which is why the handler
        here is a named method.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 5</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>Write a class that owns a background processing loop and a bounded queue, implementing
    <code>IAsyncDisposable</code> correctly. Then state precisely what breaks if you omit the await on
    the loop task, and what breaks if you dispose the <code>CancellationTokenSource</code> first.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10"><code>using System.Threading.Channels;

public sealed class StatementDispatcher : IAsyncDisposable
{
    private readonly Channel&lt;Statement&gt; _queue;
    private readonly CancellationTokenSource _shutdown = new();
    private readonly Task _loop;
    private readonly ILogger&lt;StatementDispatcher&gt; _logger;
    private bool _disposed;

    public StatementDispatcher(ILogger&lt;StatementDispatcher&gt; logger)
    {
        _logger = logger;
        _queue = Channel.CreateBounded&lt;Statement&gt;(new BoundedChannelOptions(1_000)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true
        });

        _loop = ProcessAsync(_shutdown.Token);
    }

    public ValueTask EnqueueAsync(Statement statement, CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return _queue.Writer.WriteAsync(statement, ct);
    }

    private async Task ProcessAsync(CancellationToken ct)
    {
        try
        {
            await foreach (Statement statement in _queue.Reader.ReadAllAsync(ct)
                               .ConfigureAwait(false))
            {
                await SendAsync(statement, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected during shutdown.
        }
        catch (Exception ex)
        {
            // A background loop must never let an exception escape: there is
            // no caller to catch it, and it would become unobserved.
            _logger.LogError(ex, "Dispatcher loop failed");
        }
    }

    private static Task SendAsync(Statement statement, CancellationToken ct) =&gt;
        Task.Delay(1, ct);

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // 1. Stop accepting new work, so the loop can drain and exit.
        _queue.Writer.TryComplete();

        // 2. Signal cancellation for work already in flight.
        await _shutdown.CancelAsync().ConfigureAwait(false);

        // 3. WAIT for the loop to actually finish.
        try
        {
            await _loop.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }

        // 4. Only now dispose what this object created.
        _shutdown.Dispose();
    }
}

public sealed record Statement(string CustomerId, string Content);</code></pre>
        <p><strong>If you omit the await on <code>_loop</code>:</strong> <code>DisposeAsync</code>
        returns while the loop is still running. The caller — often a DI container tearing down a
        scope — proceeds to dispose everything else the loop depends on. The loop then throws
        <code>ObjectDisposedException</code> on a background thread with no handler. Because it is
        inside a <code>Task</code> nobody awaits, it becomes an unobserved task exception: silent,
        and invisible in logs unless you have subscribed to
        <code>TaskScheduler.UnobservedTaskException</code>.</p>
        <p>Measured, the correct version reports <code>loop actually finished: True</code> — which is
        exactly the assertion worth writing a test around.</p>
        <p><strong>If you dispose the <code>CancellationTokenSource</code> before awaiting the
        loop:</strong> the loop is still using that token. Any code that calls
        <code>ThrowIfCancellationRequested</code>, registers a callback, or passes the token onward
        gets <code>ObjectDisposedException</code> rather than the clean
        <code>OperationCanceledException</code> your <code>catch</code> expects. Shutdown then logs an
        error on every deployment, and the natural response — widening the catch — hides real
        failures.</p>
        <p><strong>The general shape:</strong> stop intake, signal, await, then dispose. Every one of
        those steps is in that order for a reason, and the order is the same for any type owning a
        background loop.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 6</span>
      <span class="pill pill--hard">Hard</span></div>
    <p>You maintain a library type that wraps a native decoder handle obtained from a C API. Write it
    correctly, then justify each decision — including whether it needs a finaliser at all.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>It does not need a finaliser, because <code>SafeHandle</code> already has one and
        does the job better.</strong> This is the one scenario where people reach for a finaliser, and
        it is still the wrong answer.</p>
        <pre data-lang="csharp" data-net="10"><code>using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// SafeHandleZeroOrMinusOneIsInvalid encodes the convention that 0 and -1
// mean "no handle", which is what most C APIs return on failure.
public sealed class DecoderHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    private DecoderHandle() : base(ownsHandle: true)
    {
    }

    protected override bool ReleaseHandle()
    {
        // Called by the base class exactly once, on the finaliser thread if
        // the handle was never disposed. Must not allocate, must not throw,
        // and must not call anything managed.
        return NativeMethods.DecoderClose(handle) == 0;
    }
}

internal static partial class NativeMethods
{
    [LibraryImport("decoder", EntryPoint = "decoder_open",
        StringMarshalling = StringMarshalling.Utf8)]
    internal static partial DecoderHandle DecoderOpen(string path);

    [LibraryImport("decoder", EntryPoint = "decoder_close")]
    internal static partial int DecoderClose(IntPtr handle);

    [LibraryImport("decoder", EntryPoint = "decoder_read")]
    internal static partial int DecoderRead(DecoderHandle handle, Span&lt;byte&gt; buffer, int length);
}

public sealed class Decoder : IDisposable
{
    private readonly DecoderHandle _handle;
    private bool _disposed;

    public Decoder(string path)
    {
        _handle = NativeMethods.DecoderOpen(path);

        if (_handle.IsInvalid)
        {
            throw new InvalidOperationException($"Could not open decoder for {path}");
        }
    }

    public int Read(Span&lt;byte&gt; buffer)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return NativeMethods.DecoderRead(_handle, buffer, buffer.Length);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _handle.Dispose();

        // No GC.SuppressFinalize: this class has no finaliser to suppress.
        // The SafeHandle has one, and disposing it above already suppressed
        // that one.
    }
}</code></pre>
        <p><strong>Justifying each decision:</strong></p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Decision</th><th>Reason</th></tr></thead>
            <tbody>
              <tr><td>No finaliser on <code>Decoder</code></td><td>The handle lives in a <code>SafeHandle</code>, which has its own correct finaliser. A second one would add the two-collection cost to every <code>Decoder</code> for no benefit.</td></tr>
              <tr><td><code>SafeHandle</code> rather than <code>IntPtr</code></td><td>It is reference-counted, so the handle cannot be closed while a P/Invoke is using it. A raw <code>IntPtr</code> can be closed by a finaliser on another thread <em>during</em> a native call, which is a use-after-free.</td></tr>
              <tr><td>Return type of <code>DecoderOpen</code> is <code>DecoderHandle</code></td><td>The marshaller constructs it inside a constrained region, so the handle can never be leaked between the native call returning and the wrapper existing.</td></tr>
              <tr><td><code>ReleaseHandle</code> does not throw</td><td>It may run on the finaliser thread, where an exception terminates the process.</td></tr>
              <tr><td>Class is <code>sealed</code></td><td>No derived class, so no <code>protected virtual Dispose(bool)</code> is needed.</td></tr>
              <tr><td>No <code>SuppressFinalize</code></td><td>There is no finaliser on this type. Calling it would be harmless but misleading — it implies a finaliser exists.</td></tr>
            </tbody>
          </table>
        </div>
        <p><strong>The one thing that would change the answer:</strong> if <code>Decoder</code> were
        unsealed and part of a public API, it would need the full
        <code>protected virtual Dispose(bool)</code> pattern so derived classes could extend cleanup
        — but still no finaliser, for the same reason.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Does the garbage collector call <code>Dispose</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. Nothing does, unless you or a <code>using</code> calls it.
        Measured: 1,000 objects abandoned without disposal produced zero disposals after a full
        collection. The collector reclaims memory and knows nothing about handles or connections.</p></div>
      </details></li>

    <li><p>What does a <code>using</code> statement compile to?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>try</code>/<code>finally</code> with a null-checked
        <code>Dispose()</code> in the <code>finally</code>. That is why disposal runs when the body
        throws, and why nested resources dispose in reverse order.</p></div>
      </details></li>

    <li><p>What does declaring a finaliser cost, even if it never runs?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An extra collection for every instance. The object is promoted
        into the finalisation queue rather than reclaimed, so it takes a second collection to free.
        Measured: 200,000 finalisable objects still held 2.4 MB after one collection that reclaimed
        the equivalent plain objects entirely.</p></div>
      </details></li>

    <li><p>What does <code>GC.SuppressFinalize</code> do, and when do you call it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It removes the object from the finalisation queue, restoring
        single-collection behaviour. Call it at the end of <code>Dispose</code> on any type that has a
        finaliser. Measured: 1,000 properly disposed objects ran zero finalisers; 1,000 undisposed
        ones ran 1,000.</p>
        <p>A sealed type with no finaliser does not need it.</p></div>
      </details></li>

    <li><p>What does the <code>disposing</code> parameter in <code>Dispose(bool disposing)</code>
      actually mean?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>"Is it safe to touch other managed objects." It is
        <code>true</code> when a human called <code>Dispose</code> and <code>false</code> when the
        finaliser called it — because during finalisation the objects this one references may already
        have been finalised, and finalisation order is not guaranteed.</p></div>
      </details></li>

    <li><p>Why is a handle leak invisible on a memory graph?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Handles are not memory. The finaliser that would release them
        runs only when a collection runs, and collections are triggered by memory pressure. A loop
        that leaks handles while allocating almost nothing never triggers one — which is exactly how
        Ledger's archiver exhausted its handles with memory flat at 180 MB.</p></div>
      </details></li>

    <li><p>A type implements both interfaces and you write a plain <code>using</code>. What happens?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>Dispose</code> runs, not <code>DisposeAsync</code>, with no
        compiler warning. If the async path flushes over the network and the sync path does not, that
        is silent data loss.</p></div>
      </details></li>

    <li><p>Is <code>await using</code> faster than <code>using</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No — measured at 781 ms against 809 ms for the same work,
        essentially identical. The benefit is that the thread is released during the close, so
        disposal stops competing with request handling for the thread pool.</p></div>
      </details></li>

    <li><p>Your class is given an <code>HttpClient</code> in its constructor. Do you dispose it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>No. Dispose what you created. That client is shared — often by
        <code>IHttpClientFactory</code> — and disposing it breaks every other consumer, surfacing as
        <code>ObjectDisposedException</code> on an unrelated request later.</p></div>
      </details></li>

    <li><p>Which analyser rule would have caught the Ledger incident, and why is it off by default?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><strong>CA2000</strong> — an object created and not disposed
        before going out of scope. It is off by default because it produces false positives when
        ownership is transferred to another object, which is a real cost. It is still worth enabling:
        the false positives are visible at build time, and the true positive was a production outage
        two years later.</p></div>
      </details></li>
  </ol>
</section>
`
});
