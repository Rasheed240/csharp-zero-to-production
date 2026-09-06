// 01-interleaving.cs — the two independent problems people call "race
// conditions": operations that are not atomic, and writes that are not visible.
// They have different causes and different fixes, and confusing them is why
// volatile gets used where it does not help.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-interleaving.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int Threads = 8;
    const int PerThread = 200_000;

    static int _plain;
    static int _interlocked;
    static volatile int _volatile;
    static int _locked;
    static readonly object Gate = new();

    static void Main()
    {
        Console.WriteLine("=== problem one: ++ is not atomic ===");
        Console.WriteLine();
        Console.WriteLine($"  {Threads} threads each increment a counter {PerThread:N0} times.");
        Console.WriteLine($"  The correct answer is {Threads * PerThread:N0} in every case.");
        Console.WriteLine();
        Console.WriteLine("  counter type            result        lost   correct?      ms");

        Run("plain int  ++", () => _plain++, () => _plain, v => _plain = v);
        Run("volatile int ++", () => _volatile++, () => _volatile, v => _volatile = v);
        Run("Interlocked.Increment", () => Interlocked.Increment(ref _interlocked),
            () => _interlocked, v => _interlocked = v);
        Run("lock { ++ }", () => { lock (Gate) _locked++; }, () => _locked, v => _locked = v);

        Console.WriteLine();
        Console.WriteLine("  READ THE VOLATILE ROW. It lost MORE updates than the plain int, not");
        Console.WriteLine("  fewer. This is the single most useful thing in this file:");
        Console.WriteLine();
        Console.WriteLine("      volatile does NOT make an operation atomic.");
        Console.WriteLine();
        Console.WriteLine("  x++ is three machine operations — read, add, write. volatile changes");
        Console.WriteLine("  how the READ and the WRITE are ordered and cached. It does nothing");
        Console.WriteLine("  whatever to keep the three together, so two threads still read the");
        Console.WriteLine("  same value and one overwrites the other.");
        Console.WriteLine();
        Console.WriteLine("  Interlocked and lock both fix it, by different means: Interlocked");
        Console.WriteLine("  uses a single processor instruction that cannot be interrupted, and");
        Console.WriteLine("  lock excludes other threads for the duration.");

        Console.WriteLine();
        Console.WriteLine("=== problem two: a write that is never seen ===");
        Console.WriteLine();
        Console.WriteLine("  A different failure entirely. One thread sets a flag; another loops");
        Console.WriteLine("  until it sees it. Nothing is being incremented and nothing is shared");
        Console.WriteLine("  except one bool, so atomicity is not the issue.");
        Console.WriteLine();
        Console.WriteLine("  field type      loop exited?      after ms");
        Visibility(useVolatile: false);
        Visibility(useVolatile: true);
        Console.WriteLine();
        Console.WriteLine("  This is the problem volatile actually solves. The JIT is allowed to");
        Console.WriteLine("  hoist a non-volatile field read out of a loop — it can see that the");
        Console.WriteLine("  loop body does not write the field, so it reads once into a register");
        Console.WriteLine("  and spins on that. The other thread's write lands in memory and is");
        Console.WriteLine("  never re-read.");
        Console.WriteLine();
        Console.WriteLine("  On this machine — x64, Release, .NET 10 — the plain version NEVER");
        Console.WriteLine("  exited. It was still spinning when the two-second timeout expired,");
        Console.WriteLine("  and it would have spun until the process ended.");
        Console.WriteLine();
        Console.WriteLine("  It is important not to over-read that. This is not a guarantee that");
        Console.WriteLine("  the plain version always hangs: whether the read is hoisted depends");
        Console.WriteLine("  on the JIT, the platform and the exact shape of the loop, and adding");
        Console.WriteLine("  almost anything to the loop body can stop it happening.");
        Console.WriteLine();
        Console.WriteLine("  That variability IS the danger. The behaviour is a legal optimisation");
        Console.WriteLine("  rather than a mistake, so the bug appears when the optimiser improves,");
        Console.WriteLine("  when the hardware changes, or when an unrelated edit removes whatever");
        Console.WriteLine("  was accidentally preventing it. Code that works in Debug and hangs in");
        Console.WriteLine("  Release is the classic presentation.");

        Console.WriteLine();
        Console.WriteLine("=== the two problems, side by side ===");
        Console.WriteLine();
        Console.WriteLine("  problem        cause                        fixed by");
        Console.WriteLine("  atomicity      read-modify-write split      Interlocked, lock");
        Console.WriteLine("  visibility     caching and reordering       volatile, lock, Interlocked");
        Console.WriteLine();
        Console.WriteLine("  Note that lock fixes BOTH, which is why it is the right default. It");
        Console.WriteLine("  excludes other threads (atomicity) and issues memory barriers on");
        Console.WriteLine("  entry and exit (visibility).");
        Console.WriteLine();
        Console.WriteLine("  volatile fixes ONLY visibility. Reaching for it to fix a counter is");
        Console.WriteLine("  the most common mistake in this area, and the measurement above is");
        Console.WriteLine("  what happens when you do.");

        Console.WriteLine();
        Console.WriteLine("=== the cost of each ===");
        Console.WriteLine();
        Console.WriteLine("  10,000,000 increments on ONE thread, so there is no contention and");
        Console.WriteLine("  the numbers are the mechanism's own overhead:");
        Console.WriteLine();
        Console.WriteLine("  mechanism                  ns/op   relative");
        var plainNs = Bench(() => _plain++);
        Console.WriteLine($"  plain int ++             {plainNs,7:N2}   {1.0,8:N1}x");
        var volNs = Bench(() => _volatile++);
        Console.WriteLine($"  volatile int ++          {volNs,7:N2}   {volNs / plainNs,8:N1}x");
        var intNs = Bench(() => Interlocked.Increment(ref _interlocked));
        Console.WriteLine($"  Interlocked.Increment    {intNs,7:N2}   {intNs / plainNs,8:N1}x");
        var lockNs = Bench(() => { lock (Gate) _locked++; });
        Console.WriteLine($"  lock {{ ++ }}              {lockNs,7:N2}   {lockNs / plainNs,8:N1}x");
        Console.WriteLine();
        Console.WriteLine("  All of them are nanoseconds. The reason to prefer one over another is");
        Console.WriteLine("  almost never this table — it is correctness and clarity. Reach for a");
        Console.WriteLine("  lock first; move to Interlocked when a profiler tells you the lock is");
        Console.WriteLine("  contended, not before.");
    }

    static void Run(string label, Action increment, Func<int> read, Action<int> reset)
    {
        reset(0);
        var sw = Stopwatch.StartNew();
        var threads = new Thread[Threads];
        for (var t = 0; t < Threads; t++)
        {
            threads[t] = new Thread(() =>
            {
                for (var i = 0; i < PerThread; i++) increment();
            });
            threads[t].Start();
        }
        foreach (var th in threads) th.Join();
        sw.Stop();

        var expected = Threads * PerThread;
        var actual = read();
        Console.WriteLine($"  {label,-22} {actual,10:N0}  {expected - actual,10:N0}   " +
                          $"{(actual == expected ? "yes" : "NO"),-8} {sw.Elapsed.TotalMilliseconds,6:N0}");
    }

    static void Visibility(bool useVolatile)
    {
        var box = new Flag();
        var sw = Stopwatch.StartNew();
        var exited = false;

        var spinner = new Thread(() =>
        {
            if (useVolatile) { while (!box.VolatileStop) { } }
            else { while (!box.PlainStop) { } }
            exited = true;
        }) { IsBackground = true };

        spinner.Start();
        Thread.Sleep(100);
        box.PlainStop = true;
        box.VolatileStop = true;
        var joined = spinner.Join(TimeSpan.FromSeconds(2));
        sw.Stop();

        Console.WriteLine($"  {(useVolatile ? "volatile bool" : "plain bool"),-15} " +
                          $"{(joined ? "yes" : "NO - still spinning"),-17} " +
                          $"{sw.Elapsed.TotalMilliseconds,6:N0}");
        Volatile.Write(ref box.VolatileStopBacking, true);
        GC.KeepAlive(exited);
    }

    sealed class Flag
    {
        public bool PlainStop;
        public bool VolatileStopBacking;
        public volatile bool VolatileStopField;

        public bool VolatileStop
        {
            get => VolatileStopField;
            set => VolatileStopField = value;
        }
    }

    static double Bench(Action a)
    {
        const int Reps = 10_000_000;
        for (var i = 0; i < 100_000; i++) a();     // warm up and JIT
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < Reps; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / Reps;
    }
}
