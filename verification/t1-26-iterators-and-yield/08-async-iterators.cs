// 08-async-iterators.cs — the asynchronous form of the same feature. Same state
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
    // An async iterator: `async`, returns IAsyncEnumerable<T>, uses yield return.
    static async IAsyncEnumerable<int> PagesAsync(
        int pages,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        for (var page = 1; page <= pages; page++)
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
    //   the generated 'IAsyncEnumerable<>.GetAsyncEnumerator' will be unconsumed
    //
    // Suppressed here ONLY so this file can demonstrate the resulting behaviour with a
    // clean build. In real code the warning is the fix instruction.
#pragma warning disable CS8425
    static async IAsyncEnumerable<int> PagesIgnoringToken(
        int pages,
        CancellationToken cancellationToken = default)
    {
        for (var page = 1; page <= pages; page++)
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
        Console.WriteLine($"  is IAsyncEnumerable<int> : {seq is IAsyncEnumerable<int>}");
        Console.WriteLine($"  is IEnumerable<int>      : {seq is IEnumerable<int>}");
        Console.WriteLine("  A different interface pair: IAsyncEnumerable/IAsyncEnumerator,");
        Console.WriteLine("  whose MoveNextAsync returns ValueTask<bool> and whose");
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
        Console.WriteLine("  There is no LINQ on IAsyncEnumerable<T> in the base library.");
        Console.WriteLine("  Where/Select/ToList over one need System.Linq.Async, or a");
        Console.WriteLine("  hand-written await foreach.");
        var manual = new List<int>();
        await foreach (var page in PagesAsync(3))
            if (page % 2 == 1) manual.Add(page * 10);
        Console.WriteLine($"  hand-written filter+project : {string.Join(", ", manual)}");
    }
}
