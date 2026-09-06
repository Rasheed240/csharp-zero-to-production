// 03-async-disposable.cs — IAsyncDisposable, await using, and the two ways a
// type that implements both interfaces gets disposed by the wrong one.
//
// Run:  dotnet run 03-async-disposable.cs -c Release
//
// EXACT vs RATIO: which method runs is deterministic. The blocking measurement
// is a ratio against the non-blocking version.

using System.Diagnostics;

await WhichOneRuns();
await DisposeAsyncOrder();
BlockingInDispose();
await ExceptionDuringDisposal();
await AsyncIteratorDisposal();

// ---------------------------------------------------------------------------
// 1. A type implementing BOTH interfaces. Which one runs depends entirely on
//    how you wrote the using, and the compiler will not warn you.
// ---------------------------------------------------------------------------
static async Task WhichOneRuns()
{
    Console.WriteLine("1. Both interfaces implemented - which one runs?");
    Console.WriteLine();

    Console.WriteLine("   await using:");
    await using (var a = new BothInterfaces("a"))
    {
        Console.WriteLine("     body");
    }

    Console.WriteLine();
    Console.WriteLine("   plain using (no await):");
    using (var b = new BothInterfaces("b"))
    {
        Console.WriteLine("     body");
    }

    Console.WriteLine();
    Console.WriteLine("   The second one compiled without a warning and called the SYNCHRONOUS");
    Console.WriteLine("   path. On a type where DisposeAsync flushes a buffer over the network");
    Console.WriteLine("   and Dispose does not, that is silent data loss.");
    Console.WriteLine();
    Console.WriteLine("   There is no compiler diagnostic for this. The only defence is a code");
    Console.WriteLine("   review habit: if a type has DisposeAsync, the using must be awaited.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. Reverse order still applies, and the awaits are sequential.
// ---------------------------------------------------------------------------
static async Task DisposeAsyncOrder()
{
    Console.WriteLine("2. Order and sequencing of async disposal");
    Console.WriteLine();

    await using (var outer = new AsyncResource("outer", delayMs: 20))
    await using (var middle = new AsyncResource("middle", delayMs: 20))
    await using (var inner = new AsyncResource("inner", delayMs: 20))
    {
        Console.WriteLine("     all three open");
    }

    Console.WriteLine();
    Console.WriteLine("   Reverse order, and each DisposeAsync is AWAITED before the next");
    Console.WriteLine("   one starts. Three resources taking 20 ms each to close cost 60 ms,");
    Console.WriteLine("   not 20. Nested await using does not parallelise shutdown.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. The reason IAsyncDisposable exists: the alternative is blocking.
// ---------------------------------------------------------------------------
static void BlockingInDispose()
{
    Console.WriteLine("3. What synchronous disposal of an async resource costs");
    Console.WriteLine();

    const int count = 50;

    var sw = Stopwatch.StartNew();
    for (int i = 0; i < count; i++)
    {
        // WRONG in a real service: blocks the calling thread for the whole
        // flush. Shown here to measure what the async version avoids.
        var resource = new AsyncResource($"sync-{i}", delayMs: 4, quiet: true);
        resource.Dispose();
    }
    sw.Stop();
    double blocking = sw.Elapsed.TotalMilliseconds;

    sw.Restart();
    Task.Run(async () =>
    {
        for (int i = 0; i < count; i++)
        {
            var resource = new AsyncResource($"async-{i}", delayMs: 4, quiet: true);
            await resource.DisposeAsync();
        }
    }).GetAwaiter().GetResult();
    sw.Stop();
    double asynchronous = sw.Elapsed.TotalMilliseconds;

    Console.WriteLine($"   {count} resources, 4 ms of I/O to close each");
    Console.WriteLine($"     Dispose (blocks the thread)  : {blocking,7:F0} ms");
    Console.WriteLine($"     DisposeAsync (yields)        : {asynchronous,7:F0} ms");
    Console.WriteLine();
    Console.WriteLine("   The WALL CLOCK is similar - both wait the same 4 ms per resource.");
    Console.WriteLine("   That is not the point and it is the most common misreading.");
    Console.WriteLine();
    Console.WriteLine("   The difference is what the thread does while waiting. The blocking");
    Console.WriteLine("   version occupies a thread-pool thread for the whole close. Under");
    Console.WriteLine("   load, disposal competes for threads with request handling, which is");
    Console.WriteLine("   how a slow database close turns into thread-pool starvation.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. An exception thrown during disposal replaces or masks the body's exception.
// ---------------------------------------------------------------------------
static async Task ExceptionDuringDisposal()
{
    Console.WriteLine("4. When disposal itself throws");
    Console.WriteLine();

    try
    {
        await using var failing = new ThrowsOnDispose();
        Console.WriteLine("     body completed normally");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"     caught from disposal: {ex.GetType().Name}: {ex.Message}");
    }

    Console.WriteLine();

    try
    {
        await using var failing = new ThrowsOnDispose();
        throw new InvalidOperationException("the body failed");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"     body threw, and we caught: {ex.GetType().Name}: {ex.Message}");
    }

    Console.WriteLine();
    Console.WriteLine("   The BODY exception was lost. The disposal exception replaced it,");
    Console.WriteLine("   because it was thrown from the finally block while the first was");
    Console.WriteLine("   propagating. The original cause of the failure is gone from the logs.");
    Console.WriteLine();
    Console.WriteLine("   This is why a Dispose or DisposeAsync implementation should not");
    Console.WriteLine("   throw. Log and swallow, or you destroy the diagnostic information");
    Console.WriteLine("   for the failure that actually mattered.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 5. An async iterator is disposed by await foreach, including on early exit.
// ---------------------------------------------------------------------------
static async Task AsyncIteratorDisposal()
{
    Console.WriteLine("5. await foreach disposes the iterator, even on break");
    Console.WriteLine();

    await foreach (int value in CountingSequence())
    {
        Console.WriteLine($"     got {value}");
        if (value == 2)
        {
            Console.WriteLine("     breaking early");
            break;
        }
    }

    Console.WriteLine();
    Console.WriteLine("   The finally inside the iterator ran on break. await foreach calls");
    Console.WriteLine("   DisposeAsync on the enumerator, which resumes the iterator at its");
    Console.WriteLine("   finally blocks. This is what makes a streaming database read safe");
    Console.WriteLine("   to abandon part-way.");

    static async IAsyncEnumerable<int> CountingSequence()
    {
        try
        {
            for (int i = 1; i <= 5; i++)
            {
                await Task.Delay(1);
                yield return i;
            }
        }
        finally
        {
            Console.WriteLine("     iterator finally block ran (connection would close here)");
        }
    }
}

// ---------------------------------------------------------------------------

sealed class BothInterfaces : IDisposable, IAsyncDisposable
{
    private readonly string _name;

    public BothInterfaces(string name) => _name = name;

    public void Dispose() => Console.WriteLine($"     Dispose (synchronous) ran for {_name}");

    public ValueTask DisposeAsync()
    {
        Console.WriteLine($"     DisposeAsync ran for {_name}");
        return ValueTask.CompletedTask;
    }
}

sealed class AsyncResource : IDisposable, IAsyncDisposable
{
    private readonly string _name;
    private readonly int _delayMs;
    private readonly bool _quiet;
    private bool _disposed;

    public AsyncResource(string name, int delayMs, bool quiet = false)
    {
        _name = name;
        _delayMs = delayMs;
        _quiet = quiet;
        if (!quiet)
        {
            Console.WriteLine($"     open    {name}");
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // Blocking equivalent of the flush below. This is what you are forced
        // into when a type only offers synchronous disposal.
        Thread.Sleep(_delayMs);

        if (!_quiet)
        {
            Console.WriteLine($"     dispose {_name} (blocking)");
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        await Task.Delay(_delayMs).ConfigureAwait(false);

        if (!_quiet)
        {
            Console.WriteLine($"     dispose {_name} (async)");
        }
    }
}

sealed class ThrowsOnDispose : IAsyncDisposable
{
    public ValueTask DisposeAsync() =>
        throw new IOException("the connection could not be flushed");
}
