// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable
// Suppressed only because NoAttribute deliberately omits the attribute so that
// exercise 3 can measure the difference. See the exercise output.
#:property NoWarn=CS8425

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;
    static int _produced;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: when does the producer run? =====");
        Console.WriteLine();
        Volatile.Write(ref _produced, 0);
        var stream = Counting(5);
        Console.WriteLine($"  after calling the method     : {Volatile.Read(ref _produced)} produced");
        Consume(stream, take: 2).GetAwaiter().GetResult();
        Console.WriteLine($"  after consuming 2 items      : {Volatile.Read(ref _produced)} produced");
        Console.WriteLine();
        Console.WriteLine("  Calling an async iterator runs NONE of its body. It returns the state");
        Console.WriteLine("  machine and stops. This is the opposite of a normal async method,");
        Console.WriteLine("  which runs eagerly to its first await (t2-04: a Task is hot).");
        Console.WriteLine("  An IAsyncEnumerable is COLD: work happens only while you enumerate,");
        Console.WriteLine("  and stopping early means the rest never runs.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how many times does it run? =====");
        Console.WriteLine();
        Volatile.Write(ref _produced, 0);
        var twice = Counting(3);
        Consume(twice, take: 3).GetAwaiter().GetResult();
        Consume(twice, take: 3).GetAwaiter().GetResult();
        Console.WriteLine($"  enumerated twice, produced   : {Volatile.Read(ref _produced)} items");
        Console.WriteLine();
        Console.WriteLine("  Six, not three. Each enumeration runs the producer again, exactly");
        Console.WriteLine("  like IEnumerable<T> (t1-25). If the producer hits a database, you");
        Console.WriteLine("  have queried it twice — and unlike a List<T>, nothing about the type");
        Console.WriteLine("  warns you. Materialise with ToListAsync if you need it more than");
        Console.WriteLine("  once, and be deliberate about it.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which of these cancel? =====");
        Console.WriteLine();
        Console.WriteLine("  producer                              items   stopped after");
        Cancel("no attribute + WithCancellation", useAttribute: false);
        Cancel("[EnumeratorCancellation] + With", useAttribute: true);
        Console.WriteLine();
        Console.WriteLine("  Without the attribute the compiler has nowhere to route the token");
        Console.WriteLine("  supplied by WithCancellation, so the producer's parameter stays");
        Console.WriteLine("  default(CancellationToken) — which can never fire. The stream runs");
        Console.WriteLine("  to completion and WithCancellation is silently a no-op.");
        Console.WriteLine();
        Console.WriteLine("  The compiler DOES catch this: warning CS8425 fires on any async");
        Console.WriteLine("  iterator that takes a CancellationToken without the attribute. This");
        Console.WriteLine("  file suppresses it deliberately so the broken version can be");
        Console.WriteLine("  measured; in real code, treat CS8425 as an error.");
        Console.WriteLine();
        Console.WriteLine("  Its limit: it fires only when a token parameter EXISTS. An async");
        Console.WriteLine("  iterator with no token at all is uncancellable and warns about");
        Console.WriteLine("  nothing, so adding the parameter is still your job.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: does the cleanup run? =====");
        Console.WriteLine();
        Console.WriteLine($"  await foreach, break at 3    : {AwaitForeachBreak()}");
        Console.WriteLine($"  manual enumeration, no dispose: {ManualNoDispose()}");
        Console.WriteLine();
        Console.WriteLine("  await foreach compiles the DisposeAsync call into a finally, so");
        Console.WriteLine("  break, return and throw all resume the iterator at its own finally.");
        Console.WriteLine();
        Console.WriteLine("  Manual enumeration without disposing leaves the iterator suspended");
        Console.WriteLine("  forever. An async iterator has no finaliser, so the finally may never");
        Console.WriteLine("  run at all — whatever it holds (a connection, a file handle, a lock)");
        Console.WriteLine("  is held until the process ends.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: buffer or stream? =====");
        Console.WriteLine();
        Console.WriteLine("  200,000 rows, measured both ways:");
        Console.WriteLine();
        Console.WriteLine("  approach     retained MB   first item ms   total ms");
        BufferVsStream();
        Console.WriteLine();
        Console.WriteLine("  Stream when: the result is unbounded or caller-controlled in size,");
        Console.WriteLine("  the consumer can start work on the first item, or you are writing to");
        Console.WriteLine("  a response body or a file.");
        Console.WriteLine();
        Console.WriteLine("  Buffer when: the set is small and bounded, you need it more than");
        Console.WriteLine("  once, you need its count up front, you must be able to fail with a");
        Console.WriteLine("  clean status code, or you want the database connection released as");
        Console.WriteLine("  early as possible.");
        Console.WriteLine();
        Console.WriteLine("  That last one is the trade-off people miss. Streaming holds the");
        Console.WriteLine("  connection for the whole response, at the CLIENT's pace. On a");
        Console.WriteLine("  100-connection pool with slow clients, buffering can be the more");
        Console.WriteLine("  scalable choice, and 'always stream' is as wrong as 'always buffer'.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    // --- producers ------------------------------------------------------------
    static async IAsyncEnumerable<int> Counting(int n)
    {
        for (var i = 0; i < n; i++)
        {
            await Task.Delay(5).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    static async IAsyncEnumerable<int> NoAttribute(CancellationToken ct = default)
    {
        for (var i = 0; i < 100; i++)
        {
            await Task.Delay(5, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    static async IAsyncEnumerable<int> WithAttribute(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var i = 0; i < 100; i++)
        {
            await Task.Delay(5, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    static async IAsyncEnumerable<int> WithCleanup(StrongBox<bool> ran)
    {
        try
        {
            for (var i = 0; i < 100; i++)
            {
                await Task.Delay(5).ConfigureAwait(false);
                yield return i;
            }
        }
        finally { ran.Value = true; }
    }

    // --- harness --------------------------------------------------------------
    static async Task Consume(IAsyncEnumerable<int> source, int take)
    {
        var seen = 0;
        await foreach (var v in source.ConfigureAwait(false))
        {
            _sink += v;
            if (++seen == take) break;
        }
    }

    static void Cancel(string label, bool useAttribute)
    {
        Volatile.Write(ref _produced, 0);
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(60);
        var sw = Stopwatch.StartNew();
        try { CancelCore(useAttribute, cts.Token).GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }
        Console.WriteLine($"  {label,-36} {Volatile.Read(ref _produced),6}   {sw.Elapsed.TotalMilliseconds,10:N0} ms");
    }

    static async Task CancelCore(bool useAttribute, CancellationToken ct)
    {
        var source = useAttribute ? WithAttribute() : NoAttribute();
        await foreach (var v in source.WithCancellation(ct).ConfigureAwait(false)) _sink += v;
    }

    static bool AwaitForeachBreak()
    {
        var ran = new StrongBox<bool>(false);
        BreakCore(ran).GetAwaiter().GetResult();
        return ran.Value;
    }

    static async Task BreakCore(StrongBox<bool> ran)
    {
        var seen = 0;
        await foreach (var v in WithCleanup(ran).ConfigureAwait(false))
        {
            _sink += v;
            if (++seen == 3) break;
        }
    }

    static bool ManualNoDispose()
    {
        var ran = new StrongBox<bool>(false);
        ManualCore(ran).GetAwaiter().GetResult();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        return ran.Value;
    }

    static async Task ManualCore(StrongBox<bool> ran)
    {
        var e = WithCleanup(ran).GetAsyncEnumerator();
        for (var i = 0; i < 3; i++) await e.MoveNextAsync().ConfigureAwait(false);
        // deliberately no DisposeAsync
    }

    static void BufferVsStream()
    {
        const int Rows = 200_000;

        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        var before = GC.GetTotalMemory(true);
        var sw = Stopwatch.StartNew();
        var list = BufferAll(Rows).GetAwaiter().GetResult();
        var bufFirst = sw.Elapsed.TotalMilliseconds;
        var bufTotal = bufFirst;
        var bufMb = (GC.GetTotalMemory(true) - before) / 1024.0 / 1024.0;
        _sink += list.Count;
        Console.WriteLine($"  buffer     {bufMb,11:N1}   {bufFirst,13:N0}   {bufTotal,8:N0}");
        list = null!;

        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        before = GC.GetTotalMemory(true);
        sw = Stopwatch.StartNew();
        var streamFirst = StreamAll(Rows).GetAwaiter().GetResult();
        var streamTotal = sw.Elapsed.TotalMilliseconds;
        var streamMb = (GC.GetTotalMemory(true) - before) / 1024.0 / 1024.0;
        Console.WriteLine($"  stream     {Math.Max(streamMb, 0),11:N1}   {streamFirst,13:N0}   {streamTotal,8:N0}");
    }

    static async Task<List<byte[]>> BufferAll(int rows)
    {
        var all = new List<byte[]>(rows);
        for (var page = 0; page < rows / 1000; page++)
        {
            await Task.Delay(1).ConfigureAwait(false);
            for (var i = 0; i < 1000; i++) all.Add(new byte[512]);
        }
        return all;
    }

    static async Task<double> StreamAll(int rows)
    {
        var sw = Stopwatch.StartNew();
        var first = -1.0;
        await foreach (var row in StreamRows(rows).ConfigureAwait(false))
        {
            if (first < 0) first = sw.Elapsed.TotalMilliseconds;
            _sink += row.Length;
        }
        return first;
    }

    static async IAsyncEnumerable<byte[]> StreamRows(int rows)
    {
        for (var page = 0; page < rows / 1000; page++)
        {
            await Task.Delay(1).ConfigureAwait(false);
            for (var i = 0; i < 1000; i++) yield return new byte[512];
        }
    }
}
