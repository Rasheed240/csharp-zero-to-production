// 03-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static int _counter;
    static volatile int _volatileCounter;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which of these are correct? =====");
        Console.WriteLine();
        Console.WriteLine("  4 threads x 250,000 increments. Correct answer is 1,000,000.");
        Console.WriteLine();
        Console.WriteLine("  variant                     result   correct?");
        Counter("x++", () => _counter++, () => _counter, () => _counter = 0);
        Counter("volatile x++", () => _volatileCounter++, () => _volatileCounter,
                () => _volatileCounter = 0);
        Counter("Interlocked.Increment", () => Interlocked.Increment(ref _counter),
                () => _counter, () => _counter = 0);
        Console.WriteLine();
        Console.WriteLine("  volatile does NOT fix a counter. It affects how a field is read and");
        Console.WriteLine("  written, not whether read-modify-write stays together. Only");
        Console.WriteLine("  Interlocked (a single uninterruptible instruction) or a lock");
        Console.WriteLine("  (exclusion) makes ++ atomic.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: find the window =====");
        Console.WriteLine();
        Console.WriteLine("      if (!_seen.Contains(key)) { Charge(); _seen.Add(key); }");
        Console.WriteLine();
        Console.WriteLine("  200 trials, 8 threads racing on the same key each time:");
        Console.WriteLine();
        Console.WriteLine("  implementation                 trials wrong");
        Console.WriteLine($"    check-then-act               {CheckThenAct(),4} of 200");
        Console.WriteLine($"    lock around both             {Locked(),4} of 200");
        Console.WriteLine($"    ConcurrentDictionary.TryAdd  {TryAdd(),4} of 200");
        Console.WriteLine();
        Console.WriteLine("  The window is between the check and the record. Every thread that");
        Console.WriteLine("  arrives inside it sees 'not present' and proceeds. It is nanoseconds");
        Console.WriteLine("  wide, which is why it survives testing and fires under a retry storm.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: is a thread-safe collection enough? =====");
        Console.WriteLine();
        Console.WriteLine("      _seen.GetOrAdd(key, _ => { Charge(); return 0; });");
        Console.WriteLine();
        Console.WriteLine($"    GetOrAdd with a side effect  {GetOrAddSideEffect(),4} of 200 trials wrong");
        Console.WriteLine();
        Console.WriteLine("  No. ConcurrentDictionary guarantees that one VALUE wins, not that the");
        Console.WriteLine("  factory runs once. Under contention it can run several times, so a");
        Console.WriteLine("  side effect inside it happens several times.");
        Console.WriteLine();
        Console.WriteLine("  The general rule: a thread-safe collection makes ITS OWN methods");
        Console.WriteLine("  atomic. Anything you compose from two calls, or any side effect you");
        Console.WriteLine("  put inside one, is a new operation with a new gap.");
        Console.WriteLine();
        Console.WriteLine("  If the factory is expensive or has effects, store a Lazy<T> as the");
        Console.WriteLine("  value: the dictionary races on cheap Lazy objects, and Lazy itself");
        Console.WriteLine("  guarantees single execution.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: why does this loop never end? =====");
        Console.WriteLine();
        Console.WriteLine("      while (!_stop) { }        // on thread A");
        Console.WriteLine("      _stop = true;             // on thread B, 100 ms later");
        Console.WriteLine();
        Console.WriteLine($"    plain bool     : {Spin(useVolatile: false)}");
        Console.WriteLine($"    volatile bool  : {Spin(useVolatile: true)}");
        Console.WriteLine();
        Console.WriteLine("  The loop body does not write _stop, so the JIT may read it once into");
        Console.WriteLine("  a register and spin on that copy. Thread B's write goes to memory and");
        Console.WriteLine("  is never re-read. This is a legal optimisation, not a bug in the JIT.");
        Console.WriteLine();
        Console.WriteLine("  volatile forbids that: every read must come from memory. So this is");
        Console.WriteLine("  the case volatile is FOR — and note it is the opposite of exercise 1,");
        Console.WriteLine("  where volatile was useless. Visibility and atomicity are different");
        Console.WriteLine("  problems with different fixes.");
        Console.WriteLine();
        Console.WriteLine("  In real code prefer a CancellationToken to a volatile bool: it is the");
        Console.WriteLine("  same signal with correct memory semantics, plus callbacks, linking");
        Console.WriteLine("  and timeouts (t2-08).");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: what does 'it works on my machine' mean here? =====");
        Console.WriteLine();
        Console.WriteLine("  The SAME racy counter, 20 runs at two different contention levels.");
        Console.WriteLine();
        Console.WriteLine("  increments/thread   distinct results   correct runs   lowest");
        RaceSpread(50_000);
        RaceSpread(500_000);
        Console.WriteLine();
        Console.WriteLine("  Read those two rows together, because the contrast IS the lesson.");
        Console.WriteLine();
        Console.WriteLine("  At low contention the bug is nearly invisible: most runs produce the");
        Console.WriteLine("  right answer, and a test suite would pass again and again. At high");
        Console.WriteLine("  contention the same code is wrong every single time.");
        Console.WriteLine();
        Console.WriteLine("  Nothing about the CODE changed between those rows. What changed is how");
        Console.WriteLine("  much opportunity the threads had to interleave. That is why this class");
        Console.WriteLine("  of bug ships: development machines are quiet, test suites are small,");
        Console.WriteLine("  and production is neither.");
        Console.WriteLine();
        Console.WriteLine("  So 'it works on my machine' is not a claim about the machine. It is a");
        Console.WriteLine("  claim about one interleaving out of an enormous number — and at low");
        Console.WriteLine("  contention the harmless interleavings are the overwhelming majority.");
        Console.WriteLine();
        Console.WriteLine("  Consequences for how you work:");
        Console.WriteLine("    - a passing test is weak evidence; run the concurrent case hundreds");
        Console.WriteLine("      of times and assert on the failure COUNT");
        Console.WriteLine("    - a flaky test in concurrent code is a bug report, not a nuisance;");
        Console.WriteLine("      retrying it discards the only evidence you will get");
        Console.WriteLine("    - correctness has to come from construction and reasoning, because");
        Console.WriteLine("      testing cannot establish the absence of an interleaving");
    }

    static void RaceSpread(int perThread)
    {
        var results = new List<int>();
        for (var i = 0; i < 20; i++)
        {
            _counter = 0;
            var threads = new Thread[4];
            for (var t = 0; t < 4; t++)
            {
                threads[t] = new Thread(() => { for (var j = 0; j < perThread; j++) _counter++; });
                threads[t].Start();
            }
            foreach (var th in threads) th.Join();
            results.Add(_counter);
        }
        var expected = perThread * 4;
        Console.WriteLine($"  {perThread,17:N0}   {results.Distinct().Count(),16} " +
                          $"  {results.Count(r => r == expected),12}   {results.Min(),10:N0}");
    }

    static void Counter(string label, Action inc, Func<int> read, Action reset)
    {
        reset();
        var threads = new Thread[4];
        for (var t = 0; t < 4; t++)
        {
            threads[t] = new Thread(() => { for (var i = 0; i < 250_000; i++) inc(); });
            threads[t].Start();
        }
        foreach (var th in threads) th.Join();
        var v = read();
        Console.WriteLine($"  {label,-24} {v,10:N0}   {(v == 1_000_000 ? "yes" : "NO")}");
    }

    // --- Exercises 2 and 3 ----------------------------------------------------
    static int CheckThenAct() => RaceTrial((seen, charges, key) =>
    {
        // No synchronisation at all: this is the shipped shape.
        var set = (HashSet<string>)seen;
        if (set.Contains(key)) return;                  // CHECK
        Interlocked.Increment(ref charges.Value);       // ACT
        set.Add(key);
    }, () => new HashSet<string>(StringComparer.Ordinal));

    static int Locked() => RaceTrial((seen, charges, key) =>
    {
        var set = (HashSet<string>)seen;
        lock (set)
        {
            if (!set.Add(key)) return;
            Interlocked.Increment(ref charges.Value);
        }
    }, () => new HashSet<string>(StringComparer.Ordinal));

    static int TryAdd() => RaceTrial((seen, charges, key) =>
    {
        var dict = (ConcurrentDictionary<string, byte>)seen;
        if (!dict.TryAdd(key, 0)) return;
        Interlocked.Increment(ref charges.Value);
    }, () => new ConcurrentDictionary<string, byte>(StringComparer.Ordinal));

    static int GetOrAddSideEffect() => RaceTrial((seen, charges, key) =>
    {
        var dict = (ConcurrentDictionary<string, byte>)seen;
        dict.GetOrAdd(key, _ => { Interlocked.Increment(ref charges.Value); return (byte)0; });
    }, () => new ConcurrentDictionary<string, byte>(StringComparer.Ordinal));

    sealed class Counter32 { public int Value; }

    static int RaceTrial(Action<object, Counter32, string> pay, Func<object> makeStore)
    {
        var wrong = 0;
        for (var trial = 0; trial < 200; trial++)
        {
            var store = makeStore();
            var charges = new Counter32();
            var key = $"KEY-{trial}";
            var ready = new ManualResetEventSlim(false);

            var threads = new Thread[8];
            for (var i = 0; i < 8; i++)
            {
                threads[i] = new Thread(() =>
                {
                    ready.Wait();
                    try { pay(store, charges, key); } catch { }
                });
                threads[i].Start();
            }
            ready.Set();
            foreach (var t in threads) t.Join();

            if (Volatile.Read(ref charges.Value) != 1) wrong++;
        }
        return wrong;
    }

    // --- Exercise 4 -----------------------------------------------------------
    sealed class Flag
    {
        public bool Plain;
        public volatile bool Vol;
    }

    static string Spin(bool useVolatile)
    {
        var flag = new Flag();
        var sw = Stopwatch.StartNew();
        var spinner = new Thread(() =>
        {
            if (useVolatile) { while (!flag.Vol) { } }
            else { while (!flag.Plain) { } }
        }) { IsBackground = true };

        spinner.Start();
        Thread.Sleep(100);
        flag.Plain = true;
        flag.Vol = true;
        var joined = spinner.Join(TimeSpan.FromSeconds(2));
        return joined
            ? $"exited after {sw.Elapsed.TotalMilliseconds:N0} ms"
            : $"STILL SPINNING after {sw.Elapsed.TotalMilliseconds:N0} ms";
    }
}
