// 04-production.cs — Ledger's nightly settlement export, and the one-line change
// that made it stop working while continuing to report success. Then the second
// half of the same story: what the state machine keeps alive while it is
// suspended, and how to see it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-production.cs -c Release
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

namespace Ledger.Settlement;

public sealed record Payment(string Reference, decimal Amount);

/// <summary>Stands in for the remote settlement file service.</summary>
public sealed class ExportSink
{
    private int _written;
    public int Written => Volatile.Read(ref _written);

    public async Task WriteAsync(Payment payment, CancellationToken ct = default)
    {
        await Task.Delay(5, ct).ConfigureAwait(false);
        if (payment.Reference.StartsWith("BAD", StringComparison.Ordinal))
            throw new InvalidOperationException($"rejected by settlement: {payment.Reference}");
        Interlocked.Increment(ref _written);
    }
}

public sealed class ExportJob
{
    private readonly ExportSink _sink;
    public ExportJob(ExportSink sink) => _sink = sink;

    /// <summary>
    /// THE BUG. List&lt;T&gt;.ForEach takes an Action, so this async lambda compiled
    /// as async void. ForEach returns the instant every state machine hits its
    /// first await, and the job reports success having written nothing.
    /// </summary>
    public void RunBroken(List<Payment> payments)
    {
        payments.ForEach(async p => await _sink.WriteAsync(p).ConfigureAwait(false));
    }

    /// <summary>Sequential, and the shape the job had before the change.</summary>
    public async Task RunSequentialAsync(List<Payment> payments, CancellationToken ct = default)
    {
        foreach (var p in payments)
            await _sink.WriteAsync(p, ct).ConfigureAwait(false);
    }

    /// <summary>Concurrent and awaited. Every failure is still observed.</summary>
    public async Task RunConcurrentAsync(List<Payment> payments, CancellationToken ct = default)
    {
        await Task.WhenAll(payments.Select(p => _sink.WriteAsync(p, ct))).ConfigureAwait(false);
    }
}

class Program
{
    static void Main()
    {
        var payments = Enumerable.Range(0, 200)
            .Select(i => new Payment($"PAY-{i:D4}", 10m + i))
            .ToList();

        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger exports 200 settlements a night. A developer changed a foreach");
        Console.WriteLine("  loop to payments.ForEach(...) during a tidy-up. Tests passed. The job");
        Console.WriteLine("  ran green for nine nights. On the tenth, the bank asked where the");
        Console.WriteLine("  money was.");
        Console.WriteLine();

        var brokenSink = new ExportSink();
        var job = new ExportJob(brokenSink);
        var sw = Stopwatch.StartNew();
        job.RunBroken(payments);
        var brokenMs = sw.Elapsed.TotalMilliseconds;
        var writtenAtReturn = brokenSink.Written;
        Thread.Sleep(500);

        Console.WriteLine("  ForEach with an async lambda:");
        Console.WriteLine($"    returned after          : {brokenMs:N0} ms");
        Console.WriteLine($"    written when it returned: {writtenAtReturn} of {payments.Count}");
        Console.WriteLine($"    written 500 ms later    : {brokenSink.Written} of {payments.Count}");
        Console.WriteLine("    threw                   : nothing");
        Console.WriteLine();
        Console.WriteLine("  Look at the middle two lines. The job returned having written ZERO");
        Console.WriteLine("  payments, in single-digit milliseconds, and exited zero. The writes");
        Console.WriteLine("  did all land eventually — but only because this file sleeps for half");
        Console.WriteLine("  a second afterwards to let them. A real job returns, its caller logs");
        Console.WriteLine("  success, and the process exits with the state machines still");
        Console.WriteLine("  suspended. Whatever had not finished never does.");
        Console.WriteLine("  Note also that the 9 ms is not a speed-up. It is the time taken to");
        Console.WriteLine("  START 200 operations and abandon them.");

        Console.WriteLine();
        Console.WriteLine("  the same job written correctly:");
        var seqSink = new ExportSink();
        sw = Stopwatch.StartNew();
        new ExportJob(seqSink).RunSequentialAsync(payments).GetAwaiter().GetResult();
        Console.WriteLine($"    sequential : {sw.Elapsed.TotalMilliseconds,6:N0} ms   written {seqSink.Written}");

        var conSink = new ExportSink();
        sw = Stopwatch.StartNew();
        new ExportJob(conSink).RunConcurrentAsync(payments).GetAwaiter().GetResult();
        Console.WriteLine($"    concurrent : {sw.Elapsed.TotalMilliseconds,6:N0} ms   written {conSink.Written}");

        Console.WriteLine();
        Console.WriteLine("=== and the failure that turned it into an outage ===");
        Console.WriteLine();
        var withBad = new List<Payment>(payments) { new("BAD-9999", 1m) };

        Console.WriteLine("  correct version, one payment rejected:");
        try
        {
            new ExportJob(new ExportSink()).RunConcurrentAsync(withBad).GetAwaiter().GetResult();
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"    threw {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine("    the job fails, the alert fires, someone fixes the payment.");
        }

        Console.WriteLine();
        Console.WriteLine("  broken version, same payment: the exception has no Task to live in.");
        Console.WriteLine("  AsyncVoidMethodBuilder rethrows it on a thread pool thread, and an");
        Console.WriteLine("  unhandled exception on a pool thread terminates the process.");
        Console.WriteLine("  That is what happened on night ten: not a failed export — a crash");
        Console.WriteLine("  loop, in a job that had been reporting success for nine nights while");
        Console.WriteLine("  exporting nothing.");
        Console.WriteLine("  (This file does not run that case, because it would take the process");
        Console.WriteLine("  with it. 03-failure-modes.cs demonstrates it under a context that");
        Console.WriteLine("  catches it.)");

        Console.WriteLine();
        Console.WriteLine("=== how the state machine gives it away ===");
        Console.WriteLine();
        var lambdas = AllTypes(typeof(ExportJob).Assembly)
            .Where(t => typeof(IAsyncStateMachine).IsAssignableFrom(t) && t != typeof(IAsyncStateMachine))
            .OrderBy(t => t.Name, StringComparer.Ordinal);

        Console.WriteLine("  state machine                                 builder");
        foreach (var t in lambdas)
        {
            var builder = t.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
                .FirstOrDefault(f => f.Name.Contains("builder"));
            if (builder is null) continue;
            var name = t.DeclaringType is null ? t.Name : $"{t.DeclaringType.Name}.{t.Name}";
            Console.WriteLine($"  {name,-44}  {builder.FieldType.Name}");
        }
        Console.WriteLine();
        Console.WriteLine("  AsyncVoidMethodBuilder is the tell. There is exactly one in this");
        Console.WriteLine("  assembly and it belongs to the lambda inside RunBroken. Nobody wrote");
        Console.WriteLine("  'async void' anywhere in the file — the compiler chose it because");
        Console.WriteLine("  ForEach wanted an Action.");
        Console.WriteLine();
        Console.WriteLine("  Note the NAME of that first row. A state machine for a method is");
        Console.WriteLine("  called <Method>d__N; one for a lambda is called <<Method>b__N_M>d.");
        Console.WriteLine("  The first version of this file listed types whose name contained");
        Console.WriteLine("  'd__' and found nothing, because lambda machines do not match that.");
        Console.WriteLine("  This code now filters on the IAsyncStateMachine interface instead.");
        Console.WriteLine("  The same trap applies in a dump: grepping dumpasync output for a");
        Console.WriteLine("  method name will miss the lambda that is actually stuck.");
        Console.WriteLine();
        Console.WriteLine("  Three ways to catch this before it ships:");
        Console.WriteLine("    1. Compiler warning CS4014 fires on an un-awaited Task call, but NOT");
        Console.WriteLine("       here — there is no Task. That is why it slipped through.");
        Console.WriteLine("    2. Microsoft.VisualStudio.Threading.Analyzers, VSTHRD101, flags an");
        Console.WriteLine("       async lambda being converted to a void-returning delegate. This");
        Console.WriteLine("       is the rule that would have caught it.");
        Console.WriteLine("    3. A test that asserts the sink received 200 writes rather than");
        Console.WriteLine("       asserting the job returned without throwing.");

        Console.WriteLine();
        Console.WriteLine("=== part two: what a suspended state machine holds onto ===");
        Console.WriteLine();
        Console.WriteLine("  A local that is live ACROSS an await becomes a field, so it survives");
        Console.WriteLine("  the suspension — and stays alive for as long as the await does.");
        Console.WriteLine("  A local that is finished with before the await does not.");
        Console.WriteLine();

        foreach (var name in new[] { "BufferDiesEarly", "BufferLivesAcross" })
        {
            var t = typeof(Program).Assembly.GetTypes().First(x => x.Name.Contains(name));
            var fields = t.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
                .Where(f => !f.Name.StartsWith("<>", StringComparison.Ordinal))
                .Select(f => $"{f.FieldType.Name} {f.Name}")
                .ToArray();
            Console.WriteLine($"  {name,-20} hoisted locals: " +
                              (fields.Length == 0 ? "(none)" : string.Join(", ", fields)));
        }

        Console.WriteLine();
        Console.WriteLine("  Same 8 MB buffer, same method length, one line moved. The second one");
        Console.WriteLine("  keeps 8 MB reachable for the whole duration of the remote call.");
        Console.WriteLine("  At 500 concurrent requests that is the difference between a working");
        Console.WriteLine("  service and an OutOfMemoryException, and neither profiler nor code");
        Console.WriteLine("  review shows it, because the buffer LOOKS local and short-lived.");
        Console.WriteLine();
        Console.WriteLine("  Measured, with 50 of each suspended at once:");
        Console.WriteLine($"    dies before the await   : {MeasureHeld(early: true),7:N1} MB held");
        Console.WriteLine($"    lives across the await  : {MeasureHeld(early: false),7:N1} MB held");
        Console.WriteLine();
        Console.WriteLine("  The rule that falls out of this: keep large objects out of the region");
        Console.WriteLine("  between an allocation and an await. Finish with the buffer, or scope");
        Console.WriteLine("  it into a separate non-async method, before you suspend.");
    }

    static IEnumerable<Type> AllTypes(Assembly assembly)
    {
        var seen = new List<Type>();
        void Walk(Type t)
        {
            seen.Add(t);
            foreach (var n in t.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic))
                Walk(n);
        }
        foreach (var t in assembly.GetTypes())
            if (!t.IsNested) Walk(t);
        return seen;
    }

    const int BufferBytes = 8 * 1024 * 1024;

    static async Task<long> BufferDiesEarly(Task gate)
    {
        var buffer = new byte[BufferBytes];
        long sum = buffer.Length;                 // last use is BEFORE the await
        await gate.ConfigureAwait(false);
        return sum;
    }

    static async Task<long> BufferLivesAcross(Task gate)
    {
        var buffer = new byte[BufferBytes];
        await gate.ConfigureAwait(false);
        return buffer.Length;                     // last use is AFTER the await
    }

    static double MeasureHeld(bool early)
    {
        var gate = new TaskCompletionSource();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var before = GC.GetTotalMemory(forceFullCollection: true);

        var pending = new List<Task<long>>();
        for (var i = 0; i < 50; i++)
            pending.Add(early ? BufferDiesEarly(gate.Task) : BufferLivesAcross(gate.Task));

        Thread.Sleep(100);                        // all 50 are now suspended at the await
        var during = GC.GetTotalMemory(forceFullCollection: true);

        gate.SetResult();
        Task.WhenAll(pending).GetAwaiter().GetResult();
        return (during - before) / 1024.0 / 1024.0;
    }
}
