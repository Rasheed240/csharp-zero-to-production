// 04-production.cs — Ledger's settlement netting job. A lock held across a
// remote call, and what that does to a service under load. Then the second bug
// in the same class: a lock that protected the wrong thing.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
//
// Timings here are quoted as RATIOS against the fixed version. Absolute
// milliseconds on a desktop vary by 20% or more between runs.
// Run: dotnet run 04-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Netting;

public sealed record Position(string Counterparty, decimal Amount);

/// <summary>Stands in for the remote rates service. 20 ms per call.</summary>
public static class RatesApi
{
    private static int _calls;
    public static int Calls => Volatile.Read(ref _calls);
    public static void Reset() => Volatile.Write(ref _calls, 0);

    public static decimal GetRate(string counterparty)
    {
        Interlocked.Increment(ref _calls);
        Thread.Sleep(20);                       // a blocking remote call
        return 1.17m;
    }
}

/// <summary>
/// THE SHIPPED VERSION. The lock is correct — the totals are never wrong — and
/// it is held across a 20 ms remote call, so every caller is serialised behind
/// the network rather than behind the arithmetic.
/// </summary>
public sealed class NettingServiceV1
{
    private readonly Dictionary<string, decimal> _totals = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public void Add(Position p)
    {
        lock (_gate)
        {
            var rate = RatesApi.GetRate(p.Counterparty);      // I/O inside the lock
            _totals.TryGetValue(p.Counterparty, out var running);
            _totals[p.Counterparty] = running + p.Amount * rate;
        }
    }

    public decimal Total => _totals.Values.Sum();
}

/// <summary>
/// THE FIX. Identical locking discipline, identical correctness — the remote
/// call moved OUT of the critical section. The lock now protects only the
/// dictionary mutation, which takes nanoseconds.
/// </summary>
public sealed class NettingServiceV2
{
    private readonly Dictionary<string, decimal> _totals = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public void Add(Position p)
    {
        var rate = RatesApi.GetRate(p.Counterparty);          // outside
        lock (_gate)
        {
            _totals.TryGetValue(p.Counterparty, out var running);
            _totals[p.Counterparty] = running + p.Amount * rate;
        }
    }

    public decimal Total => _totals.Values.Sum();
}

/// <summary>
/// WRONG in a way that looks right: the lock is taken for the WRITE but not for
/// the READ. A reader can observe a Dictionary mid-resize.
/// </summary>
public sealed class NettingServiceV3
{
    private readonly Dictionary<string, decimal> _totals = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public void Add(Position p)
    {
        lock (_gate) { _totals[p.Counterparty + Guid.NewGuid()] = p.Amount; }
    }

    /// <summary>No lock. This is the bug.</summary>
    public int CountWithoutLocking() => _totals.Count;

    public bool TryReadWithoutLocking()
    {
        foreach (var _ in _totals) { }        // enumerating an unlocked Dictionary
        return true;
    }
}

class Program
{
    const int Threads = 8;
    const int PositionsPerThread = 25;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger nets settlement positions by counterparty. The netting");
        Console.WriteLine("  service is a singleton and its Add method is called from every");
        Console.WriteLine("  request thread, so it takes a lock. Correct, reviewed, shipped.");
        Console.WriteLine();
        Console.WriteLine("      lock (_gate)");
        Console.WriteLine("      {");
        Console.WriteLine("          var rate = _rates.GetRate(p.Counterparty);   // 20 ms remote");
        Console.WriteLine("          _totals[p.Counterparty] = running + p.Amount * rate;");
        Console.WriteLine("      }");
        Console.WriteLine();
        Console.WriteLine("  The totals were never wrong. The endpoint became unusable at eight");
        Console.WriteLine("  concurrent requests, and nobody could see why: CPU was near zero,");
        Console.WriteLine("  memory was flat, and the rates service reported normal latency.");
        Console.WriteLine();

        var v1 = Measure("I/O inside the lock", () => new NettingServiceV1(), (s, p) => ((NettingServiceV1)s).Add(p));
        var v2 = Measure("I/O outside the lock", () => new NettingServiceV2(), (s, p) => ((NettingServiceV2)s).Add(p));

        Console.WriteLine("  version                  relative time   contentions   remote calls");
        Console.WriteLine($"  I/O inside the lock      {v1.Ms / v2.Ms,13:N1}x   {v1.Contentions,11:N0}   {v1.Calls,12:N0}");
        Console.WriteLine($"  I/O outside the lock     {v2.Ms / v2.Ms,13:N1}x   {v2.Contentions,11:N0}   {v2.Calls,12:N0}");
        Console.WriteLine();
        Console.WriteLine("  Same work, same number of remote calls, same answer. The only");
        Console.WriteLine("  difference is what the lock spans.");
        Console.WriteLine();
        Console.WriteLine("  With the call inside, the critical section is 20 ms long, so eight");
        Console.WriteLine("  threads take turns and total time is the sum of everything. The");
        Console.WriteLine("  service has an effective concurrency of ONE regardless of how many");
        Console.WriteLine("  threads, cores or instances you give it.");
        Console.WriteLine();
        Console.WriteLine("  That is why it looked like nothing was wrong. The processor is idle");
        Console.WriteLine("  because everyone is waiting; the rates service sees normal latency");
        Console.WriteLine("  because each individual call IS fast; and no exception is ever");
        Console.WriteLine("  thrown. The only visible symptom is that throughput does not");
        Console.WriteLine("  improve when you add capacity.");

        Console.WriteLine();
        Console.WriteLine("=== the signature that identifies it ===");
        Console.WriteLine();
        Console.WriteLine("    dotnet-counters monitor --process-id <pid> System.Runtime");
        Console.WriteLine("      monitor-lock-contention-count   HIGH and climbing");
        Console.WriteLine("      cpu-usage                       low");
        Console.WriteLine("      threadpool-queue-length         climbing");
        Console.WriteLine();
        Console.WriteLine("  The contention counter is what separates this from every other");
        Console.WriteLine("  low-CPU stall in this track:");
        Console.WriteLine();
        Console.WriteLine("    lock held too long   contention HIGH, CPU low, queue growing");
        Console.WriteLine("    deadlock (03)        contention FLAT, CPU zero, queue growing");
        Console.WriteLine("    sync-over-async      contention low,  CPU low, THREADS growing");
        Console.WriteLine("    parallel saturation  contention low,  CPU 100%");
        Console.WriteLine();
        Console.WriteLine("  Then a dump names the method:");
        Console.WriteLine("    > clrstack -all      many threads in Monitor.Enter, same frame");
        Console.WriteLine("    > syncblk            one monitor, one owner, many waiters");
        Console.WriteLine();
        Console.WriteLine("  A deadlock shows a CYCLE in syncblk — two owners waiting on each");
        Console.WriteLine("  other. This shows a QUEUE: one owner, everyone else waiting. The");
        Console.WriteLine("  distinction tells you whether to look for an ordering bug or a long");
        Console.WriteLine("  critical section, and they have nothing to do with each other.");

        Console.WriteLine();
        Console.WriteLine("=== the second bug: locking the write and not the read ===");
        Console.WriteLine();
        Console.WriteLine("  The same class had a Count property that did not take the lock.");
        Console.WriteLine("  Reading looks harmless — nothing is being modified by the reader.");
        Console.WriteLine();
        var (crashes, trials) = ReadWhileWriting();
        Console.WriteLine($"  enumerating without the lock while writers hold it:");
        Console.WriteLine($"    {crashes} of {trials} trials threw InvalidOperationException");
        Console.WriteLine();
        Console.WriteLine("  A lock is a protocol, and a protocol only works if EVERY participant");
        Console.WriteLine("  follows it. A reader that skips the lock can observe a Dictionary");
        Console.WriteLine("  midway through a resize: a torn read, a missing entry, or the");
        Console.WriteLine("  exception above.");
        Console.WriteLine();
        Console.WriteLine("  The rule: the lock protects the DATA, not the method. Every path that");
        Console.WriteLine("  touches the data takes the lock, reads included. If that feels");
        Console.WriteLine("  expensive, the answer is a concurrent collection (t2-15) or an");
        Console.WriteLine("  immutable snapshot — not skipping the lock on the paths that look");
        Console.WriteLine("  read-only.");
    }

    readonly record struct Result(double Ms, long Contentions, int Calls);

    static Result Measure(string _, Func<object> make, Action<object, Position> add)
    {
        Thread.Sleep(120);
        RatesApi.Reset();
        var service = make();
        var before = Monitor.LockContentionCount;
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        var threads = new Thread[Threads];
        for (var t = 0; t < Threads; t++)
        {
            var id = t;
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                for (var i = 0; i < PositionsPerThread; i++)
                    add(service, new Position($"CP-{(id * 31 + i) % 5}", 100m));
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();

        return new Result(sw.Elapsed.TotalMilliseconds,
                          Monitor.LockContentionCount - before,
                          RatesApi.Calls);
    }

    static (int crashes, int trials) ReadWhileWriting()
    {
        const int Trials = 40;
        var crashes = 0;

        for (var trial = 0; trial < Trials; trial++)
        {
            var service = new NettingServiceV3();
            var stop = new CancellationTokenSource();
            var failed = false;

            var writer = new Thread(() =>
            {
                var i = 0;
                while (!stop.IsCancellationRequested)
                    service.Add(new Position($"CP-{i++}", 1m));
            }) { IsBackground = true };

            var reader = new Thread(() =>
            {
                while (!stop.IsCancellationRequested)
                {
                    try { service.TryReadWithoutLocking(); }
                    catch (InvalidOperationException) { failed = true; return; }
                    catch (ArgumentException) { failed = true; return; }
                    catch (IndexOutOfRangeException) { failed = true; return; }
                }
            }) { IsBackground = true };

            writer.Start();
            reader.Start();
            Thread.Sleep(25);
            stop.Cancel();
            writer.Join(500);
            reader.Join(500);
            if (failed) crashes++;
        }
        return (crashes, Trials);
    }
}
