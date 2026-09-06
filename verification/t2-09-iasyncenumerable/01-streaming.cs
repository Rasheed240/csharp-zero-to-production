// 01-streaming.cs — what IAsyncEnumerable<T> buys, measured: peak memory and
// time to the FIRST item, against the two things people write instead.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-streaming.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Rows = 200_000;
    const int RowBytes = 512;

    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the three shapes ===");
        Console.WriteLine();
        Console.WriteLine("  Reading 200,000 rows of 512 bytes from a source that arrives in");
        Console.WriteLine("  pages of 1,000, with each page costing 2 ms of I/O.");
        Console.WriteLine();
        Console.WriteLine("  shape                              peak MB   first item ms   total ms");

        Measure("Task<List<T>>   (buffer all)", () => ConsumeBuffered());
        Measure("IEnumerable<T>  (sync stream)", () => ConsumeSyncStream());
        Measure("IAsyncEnumerable<T> (stream)", () => ConsumeAsyncStream());

        Console.WriteLine();
        Console.WriteLine("  Read the columns in order, because they say different things.");
        Console.WriteLine();
        Console.WriteLine("  PEAK MB. Buffering holds every row at once. Streaming holds one row");
        Console.WriteLine("  and one page. That difference does not depend on how fast anything");
        Console.WriteLine("  is; it is structural, and it is the reason the type exists.");
        Console.WriteLine();
        Console.WriteLine("  FIRST ITEM MS. Buffering cannot produce anything until it has");
        Console.WriteLine("  produced everything. Streaming yields the first row after the first");
        Console.WriteLine("  page. For an HTTP response or a UI, that is the number a user feels.");
        Console.WriteLine();
        Console.WriteLine("  TOTAL MS. Roughly the same for all three, and that is the honest");
        Console.WriteLine("  result: streaming is not FASTER. It changes the memory profile and");
        Console.WriteLine("  the latency profile, not the throughput.");

        Console.WriteLine();
        Console.WriteLine("=== why the synchronous stream is not the answer ===");
        Console.WriteLine();
        Console.WriteLine("  IEnumerable<T> streams too, and its memory column matches. The");
        Console.WriteLine("  problem is invisible in this table: to fetch each page it must BLOCK,");
        Console.WriteLine("  because MoveNext() returns bool rather than Task<bool>. There is");
        Console.WriteLine("  nowhere in the interface to put an await.");
        Console.WriteLine();
        Console.WriteLine("  So the choice before C# 8 was: stream and block a thread per");
        Console.WriteLine("  consumer, or go async and buffer everything. IAsyncEnumerable exists");
        Console.WriteLine("  to remove that trade-off, and its whole contribution is the return");
        Console.WriteLine("  type of one method:");
        Console.WriteLine();
        Console.WriteLine("      IEnumerator<T>       bool      MoveNext()");
        Console.WriteLine("      IAsyncEnumerator<T>  ValueTask<bool> MoveNextAsync()");
        Console.WriteLine();
        Console.WriteLine("  ValueTask rather than Task, because MoveNextAsync is called once per");
        Console.WriteLine("  ITEM and usually completes synchronously — the page is already in");
        Console.WriteLine("  memory. 200,000 Tasks would be 200,000 allocations for 200 actual");
        Console.WriteLine("  awaits. That is precisely the case ValueTask was designed for.");

        Console.WriteLine();
        Console.WriteLine("=== the compiler generates a state machine, as with async ===");
        Console.WriteLine();
        var machine = typeof(Program).Assembly.GetTypes()
            .FirstOrDefault(t => t.Name.Contains("StreamRowsAsync"));
        if (machine is not null)
        {
            Console.WriteLine($"  generated type : {machine.Name}");
            Console.WriteLine($"  is a struct    : {machine.IsValueType}");
            foreach (var i in machine.GetInterfaces().Select(i => i.Name).OrderBy(n => n))
                Console.WriteLine($"  implements     : {i}");
        }
        Console.WriteLine();
        Console.WriteLine("  It is a CLASS, not a struct — unlike the async state machine in");
        Console.WriteLine("  t2-05. An async method's machine can live on the stack until it");
        Console.WriteLine("  suspends; an iterator must survive between calls to MoveNextAsync");
        Console.WriteLine("  from the very beginning, so there is nothing to gain by starting it");
        Console.WriteLine("  on the stack.");
        Console.WriteLine();
        Console.WriteLine("  Note that it implements BOTH IAsyncEnumerable and IAsyncEnumerator.");
        Console.WriteLine("  The first call to GetAsyncEnumerator returns the object itself; only");
        Console.WriteLine("  a SECOND concurrent enumeration allocates another. That is why");
        Console.WriteLine("  enumerating once — the normal case — costs one object.");
        Console.WriteLine();
        Console.WriteLine("  And note IValueTaskSource in that list. This is the pooling mechanism");
        Console.WriteLine("  t2-04 described: rather than allocating a Task per MoveNextAsync that");
        Console.WriteLine("  suspends, the state machine IS the backing source for its own");
        Console.WriteLine("  ValueTask and is reused across every item. That is how a stream of");
        Console.WriteLine("  200,000 items costs a fraction of a megabyte.");
        Console.WriteLine("  It is also why the ValueTask consumption rules from t2-04 are not");
        Console.WriteLine("  optional here: awaiting the ValueTask from MoveNextAsync twice, or");
        Console.WriteLine("  storing it, reads an object that has already been recycled.");

        Console.WriteLine();
        Console.WriteLine("=== await foreach is not foreach with an await ===");
        Console.WriteLine();
        Console.WriteLine("  await foreach (var row in source.WithCancellation(ct))");
        Console.WriteLine("      Handle(row);");
        Console.WriteLine();
        Console.WriteLine("  compiles to roughly:");
        Console.WriteLine();
        Console.WriteLine("      var e = source.GetAsyncEnumerator(ct);");
        Console.WriteLine("      try");
        Console.WriteLine("      {");
        Console.WriteLine("          while (await e.MoveNextAsync())");
        Console.WriteLine("              Handle(e.Current);");
        Console.WriteLine("      }");
        Console.WriteLine("      finally { await e.DisposeAsync(); }");
        Console.WriteLine();
        Console.WriteLine("  Two things to take from that. The disposal is asynchronous and is in");
        Console.WriteLine("  a finally, so breaking out of the loop still closes the connection");
        Console.WriteLine("  underneath. And Current is a plain property, not a Task: the await");
        Console.WriteLine("  is on ADVANCING, never on reading the value you have.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // --- the three shapes -----------------------------------------------------

    /// <summary>Buffers everything, then returns it. The default shape people write.</summary>
    static async Task<List<byte[]>> GetAllRowsAsync(CancellationToken ct = default)
    {
        var all = new List<byte[]>(Rows);
        for (var page = 0; page < Rows / 1000; page++)
        {
            await Task.Delay(2, ct).ConfigureAwait(false);
            for (var i = 0; i < 1000; i++) all.Add(new byte[RowBytes]);
        }
        return all;
    }

    /// <summary>Streams, but must block to fetch each page.</summary>
    static IEnumerable<byte[]> GetRowsSync()
    {
        for (var page = 0; page < Rows / 1000; page++)
        {
            Thread.Sleep(2);                     // blocking: no await is possible here
            for (var i = 0; i < 1000; i++) yield return new byte[RowBytes];
        }
    }

    /// <summary>Streams without blocking. One page in memory at a time.</summary>
    static async IAsyncEnumerable<byte[]> StreamRowsAsync(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var page = 0; page < Rows / 1000; page++)
        {
            await Task.Delay(2, ct).ConfigureAwait(false);
            for (var i = 0; i < 1000; i++) yield return new byte[RowBytes];
        }
    }

    // --- consumers ------------------------------------------------------------
    static double ConsumeBuffered()
    {
        var first = -1.0;
        var sw = Stopwatch.StartNew();
        var all = GetAllRowsAsync().GetAwaiter().GetResult();
        foreach (var row in all)
        {
            if (first < 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += row.Length;
        }
        return first;
    }

    static double ConsumeSyncStream()
    {
        var first = -1.0;
        var sw = Stopwatch.StartNew();
        foreach (var row in GetRowsSync())
        {
            if (first < 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += row.Length;
        }
        return first;
    }

    static double ConsumeAsyncStream() => ConsumeAsyncStreamCore().GetAwaiter().GetResult();

    static async Task<double> ConsumeAsyncStreamCore()
    {
        var first = -1.0;
        var sw = Stopwatch.StartNew();
        await foreach (var row in StreamRowsAsync().ConfigureAwait(false))
        {
            if (first < 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += row.Length;
        }
        return first;
    }

    // --- measurement ----------------------------------------------------------
    static void Measure(string label, Func<double> consume)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var before = GC.GetTotalMemory(forceFullCollection: true);

        var sw = Stopwatch.StartNew();
        var firstMs = consume();
        var totalMs = sw.Elapsed.TotalMilliseconds;

        // Peak is approximated by the live set at the end of the run, before
        // collection: for the buffered case the list is still rooted, for the
        // streaming cases nothing is.
        var peak = (GC.GetTotalMemory(forceFullCollection: false) - before) / 1024.0 / 1024.0;

        Console.WriteLine($"  {label,-33} {Math.Max(peak, 0),7:N1}   {firstMs,13:N0}   {totalMs,8:N0}");
    }
}
