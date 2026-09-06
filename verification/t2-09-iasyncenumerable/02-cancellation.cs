// 02-cancellation.cs — cancelling an async stream is not the same as cancelling
// an async method, because the token arrives in TWO places and only one attribute
// joins them up. This measures what happens when it is missing.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-cancellation.cs -c Release
#:property Nullable=enable
// CS8425 is suppressed ONLY because WithoutAttribute deliberately omits
// [EnumeratorCancellation] to demonstrate the bug. The compiler DOES warn about
// this by default, which is the good news reported in the output below.
#:property NoWarn=CS8425

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static int _produced;

    static void Main()
    {
        Console.WriteLine("=== the problem: a stream has two entry points ===");
        Console.WriteLine();
        Console.WriteLine("  An async METHOD is called once, so its token parameter is the only");
        Console.WriteLine("  way in. An async STREAM is different:");
        Console.WriteLine();
        Console.WriteLine("    1. the method call            StreamAsync(ct)");
        Console.WriteLine("    2. the enumeration            GetAsyncEnumerator(ct)");
        Console.WriteLine();
        Console.WriteLine("  Those can happen at different times, in different places, with");
        Console.WriteLine("  different tokens. Creating the stream does not start it — nothing");
        Console.WriteLine("  runs until the first MoveNextAsync — so the token that matters is");
        Console.WriteLine("  usually the one supplied at enumeration, which is what");
        Console.WriteLine("  WithCancellation sets.");
        Console.WriteLine();
        Console.WriteLine("  [EnumeratorCancellation] is what routes the SECOND one into your");
        Console.WriteLine("  method's parameter. Without it, WithCancellation is silently a no-op");
        Console.WriteLine("  on your producer.");

        Console.WriteLine();
        Console.WriteLine("=== measured: 100 items available, cancelled after 60 ms ===");
        Console.WriteLine();
        Console.WriteLine("  producer                              items produced   stopped after");

        Run("no attribute, WithCancellation", ct => WithoutAttribute(), useWith: true);
        Run("[EnumeratorCancellation], With", ct => WithAttribute(), useWith: true);
        Run("no attribute, token at CALL", ct => WithoutAttribute(ct), useWith: false);

        Console.WriteLine();
        Console.WriteLine("  Row 1 is the bug. WithCancellation supplied a token, the token was");
        Console.WriteLine("  cancelled, and the producer never saw it — because without the");
        Console.WriteLine("  attribute the compiler has no instruction to route it anywhere. The");
        Console.WriteLine("  producer's own ct parameter stayed default(CancellationToken), which");
        Console.WriteLine("  can never be cancelled.");
        Console.WriteLine();
        Console.WriteLine("  Row 3 shows the token passed at the CALL instead, which also works.");
        Console.WriteLine("  So why does the attribute exist? Because the caller frequently");
        Console.WriteLine("  cannot use row 3: they were handed an IAsyncEnumerable<T> by someone");
        Console.WriteLine("  else and the call already happened. A repository returns");
        Console.WriteLine("  IAsyncEnumerable<Invoice>; the controller enumerates it. Only");
        Console.WriteLine("  WithCancellation is available at that point.");
        Console.WriteLine();
        Console.WriteLine("  The good news, and it is easy to miss: THE COMPILER WARNS. Building");
        Console.WriteLine("  WithoutAttribute produces");
        Console.WriteLine();
        Console.WriteLine("      warning CS8425: Async-iterator has one or more parameters of type");
        Console.WriteLine("      CancellationToken but none of them is decorated with the");
        Console.WriteLine("      EnumeratorCancellation attribute, so the cancellation token");
        Console.WriteLine("      parameter from the generated GetAsyncEnumerator will be unconsumed");
        Console.WriteLine();
        Console.WriteLine("  This file suppresses CS8425 explicitly, because it needs the broken");
        Console.WriteLine("  version in order to measure it. In real code, do not suppress it —");
        Console.WriteLine("  treat it as an error. It is one of the few cases where the compiler");
        Console.WriteLine("  detects a purely semantic mistake about cancellation.");
        Console.WriteLine();
        Console.WriteLine("  The warning only fires when the iterator HAS a token parameter. An");
        Console.WriteLine("  async iterator with no token at all is silently uncancellable and");
        Console.WriteLine("  nothing complains, so the habit still has to be yours.");

        Console.WriteLine();
        Console.WriteLine("=== both tokens at once ===");
        Console.WriteLine();
        Console.WriteLine("  If a token is passed at the call AND at enumeration, the compiler");
        Console.WriteLine("  links them: your parameter receives a token cancelled when either");
        Console.WriteLine("  fires. You do not have to combine them yourself.");
        Console.WriteLine();
        Console.WriteLine($"  call token cancels first  : {BothTokens(cancelCall: true)}");
        Console.WriteLine($"  enum token cancels first  : {BothTokens(cancelCall: false)}");
        Console.WriteLine();
        Console.WriteLine("  Both stop the producer. This is the one place in .NET where linking");
        Console.WriteLine("  happens automatically, and it is worth knowing so you do not build a");
        Console.WriteLine("  second linked source on top of the one the compiler already made.");

        Console.WriteLine();
        Console.WriteLine("=== the finally block still runs ===");
        Console.WriteLine();
        Console.WriteLine("  A stream usually holds something that must be released — a database");
        Console.WriteLine("  reader, a file handle, a network connection. Cancellation must not");
        Console.WriteLine("  leak it.");
        Console.WriteLine();
        var released = CleanupOnCancel();
        Console.WriteLine($"  cancelled mid-stream, cleanup ran : {released}");
        Console.WriteLine();
        Console.WriteLine("  await foreach compiles its enumerator disposal into a finally, so");
        Console.WriteLine("  breaking, returning or throwing out of the loop all still call");
        Console.WriteLine("  DisposeAsync, which resumes your iterator at its finally block.");
        Console.WriteLine("  This is why 'await using' inside an async iterator is safe and is the");
        Console.WriteLine("  correct way to hold a connection open across a stream.");

        Console.WriteLine();
        Console.WriteLine("=== the caveat nobody mentions ===");
        Console.WriteLine();
        Console.WriteLine("  That cleanup only runs if the consumer DISPOSES the enumerator.");
        Console.WriteLine("  await foreach always does. Manual enumeration frequently does not:");
        Console.WriteLine();
        Console.WriteLine("      var e = source.GetAsyncEnumerator(ct);");
        Console.WriteLine("      while (await e.MoveNextAsync()) { ... break; }");
        Console.WriteLine("      // no DisposeAsync: the iterator is suspended forever, holding");
        Console.WriteLine("      // whatever it holds, until the GC gets to it - and an async");
        Console.WriteLine("      // iterator has no finaliser, so the finally may NEVER run.");
        Console.WriteLine();
        Console.WriteLine($"  manual enumeration, no dispose, cleanup ran : {NoDispose()}");
        Console.WriteLine();
        Console.WriteLine("  Use await foreach. If you must enumerate manually, wrap the");
        Console.WriteLine("  enumerator in 'await using'.");
        Console.WriteLine($"  (checksum {_produced})");
    }

    // --- producers ------------------------------------------------------------

    /// <summary>WRONG for a library: the enumeration token cannot reach this.</summary>
    static async IAsyncEnumerable<int> WithoutAttribute(CancellationToken ct = default)
    {
        for (var i = 0; i < 100; i++)
        {
            await Task.Delay(5, ct).ConfigureAwait(false);
            Interlocked.Increment(ref _produced);
            yield return i;
        }
    }

    /// <summary>Right: the attribute routes GetAsyncEnumerator's token here.</summary>
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

    static async IAsyncEnumerable<int> Cleanup(
        StrongBox<bool> ran, [EnumeratorCancellation] CancellationToken ct = default)
    {
        try
        {
            for (var i = 0; i < 100; i++)
            {
                await Task.Delay(5, ct).ConfigureAwait(false);
                yield return i;
            }
        }
        finally
        {
            ran.Value = true;                 // stands in for closing a connection
        }
    }

    // --- harness --------------------------------------------------------------

    static void Run(string label, Func<CancellationToken, IAsyncEnumerable<int>> make, bool useWith)
    {
        Volatile.Write(ref _produced, 0);
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(60);
        var sw = Stopwatch.StartNew();

        try { Consume(make, cts.Token, useWith).GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }

        Console.WriteLine($"  {label,-36} {Volatile.Read(ref _produced),14}   {sw.Elapsed.TotalMilliseconds,10:N0} ms");
    }

    static async Task Consume(Func<CancellationToken, IAsyncEnumerable<int>> make,
                              CancellationToken ct, bool useWith)
    {
        var source = make(useWith ? CancellationToken.None : ct);
        if (useWith)
        {
            await foreach (var _ in source.WithCancellation(ct).ConfigureAwait(false)) { }
        }
        else
        {
            await foreach (var _ in source.ConfigureAwait(false)) { }
        }
    }

    static string BothTokens(bool cancelCall)
    {
        using var call = new CancellationTokenSource();
        using var enumerate = new CancellationTokenSource();
        (cancelCall ? call : enumerate).CancelAfter(50);

        var sw = Stopwatch.StartNew();
        try
        {
            ConsumeBoth(call.Token, enumerate.Token).GetAwaiter().GetResult();
            return "ran to completion (unexpected)";
        }
        catch (OperationCanceledException)
        {
            return $"stopped after {sw.Elapsed.TotalMilliseconds:N0} ms";
        }
    }

    static async Task ConsumeBoth(CancellationToken call, CancellationToken enumerate)
    {
        await foreach (var _ in WithAttribute(call).WithCancellation(enumerate).ConfigureAwait(false)) { }
    }

    static bool CleanupOnCancel()
    {
        var ran = new StrongBox<bool>(false);
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(40);
        try { ConsumeCleanup(ran, cts.Token).GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { }
        return ran.Value;
    }

    static async Task ConsumeCleanup(StrongBox<bool> ran, CancellationToken ct)
    {
        await foreach (var _ in Cleanup(ran).WithCancellation(ct).ConfigureAwait(false)) { }
    }

    static bool NoDispose()
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
        var e = Cleanup(ran).GetAsyncEnumerator();
        for (var i = 0; i < 3; i++) await e.MoveNextAsync().ConfigureAwait(false);
        // deliberately no DisposeAsync
    }
}
