// 05-exercises.cs — every answer claimed in this module's exercises, run.
// Timings are quoted as ratios; counts and correctness are exact.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which of these lock objects are safe? =====");
        Console.WriteLine();
        Console.WriteLine("  (a) lock (this)");
        Console.WriteLine("  (b) lock (typeof(Ledger))");
        Console.WriteLine($"  (c) lock (\"ledger-gate\")  — same literal elsewhere is the SAME object: " +
                          $"{ReferenceEquals("ledger-gate", Elsewhere())}");
        Console.WriteLine("  (d) lock (_count)  where _count is an int");
        Console.WriteLine("  (e) private readonly object _gate = new();");
        Console.WriteLine();
        Console.WriteLine("  Only (e). (a) lets any holder of your object block or deadlock you.");
        Console.WriteLine("  (b) is process-wide and shared with code you did not write. (c) is");
        Console.WriteLine("  interned, so the same text anywhere in the process is one monitor —");
        Console.WriteLine("  verified above. (d) does not compile at all: CS0185, lock on a value");
        Console.WriteLine("  type. That last one is the language preventing the mistake outright.");
        Console.WriteLine();
        Console.WriteLine("  On .NET 9+ prefer: private readonly Lock _gate = new();");
        Console.WriteLine("  It is faster, cannot be locked by anyone else, and exposes TryEnter");
        Console.WriteLine("  and IsHeldByCurrentThread. But declare the FIELD as Lock — typing it");
        Console.WriteLine("  as object silently reverts to Monitor.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how long is the critical section? =====");
        Console.WriteLine();
        Console.WriteLine("      lock (_gate) { var r = Compute(x); _map[x] = r; }");
        Console.WriteLine();
        var inside = Scope(inside: true);
        var outside = Scope(inside: false);
        Console.WriteLine($"  compute inside the lock  : {inside / outside,5:N2}x the time of outside");
        Console.WriteLine();
        Console.WriteLine("  Compute reads no shared state, so it does not need protecting. Move");
        Console.WriteLine("  it out and the lock spans one dictionary write.");
        Console.WriteLine();
        Console.WriteLine("      var r = Compute(x); lock (_gate) { _map[x] = r; }");
        Console.WriteLine();
        Console.WriteLine("  This is the highest-value lock change available and it costs nothing.");
        Console.WriteLine("  The critical section is the only part that serialises, so shortening");
        Console.WriteLine("  it is the whole game.");
        Console.WriteLine();
        Console.WriteLine("  The caveat: this is only valid if Compute is PURE. If it reads the");
        Console.WriteLine("  shared state, moving it out introduces a check-then-act race (t2-11).");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: will this deadlock? =====");
        Console.WriteLine();
        Console.WriteLine("      void A() { lock (_g) { B(); } }");
        Console.WriteLine("      void B() { lock (_g) { ... } }");
        Console.WriteLine();
        Console.WriteLine($"  same thread, same monitor, nested : {Nested()}");
        Console.WriteLine();
        Console.WriteLine("  No. A monitor is REENTRANT: the owning thread may enter again, and");
        Console.WriteLine("  the runtime counts and releases on the matching exit.");
        Console.WriteLine();
        Console.WriteLine("  That is convenient and it hides a design problem. B now runs while");
        Console.WriteLine("  A is midway through mutating the state the lock protects, so B sees");
        Console.WriteLine("  a broken invariant — and no exception says so.");
        Console.WriteLine();
        Console.WriteLine("  Contrast SemaphoreSlim(1,1), which is NOT reentrant:");
        Console.WriteLine($"    same pattern with SemaphoreSlim : {SemaphoreNested()}");
        Console.WriteLine();
        Console.WriteLine("  Neither behaviour is better. They fail differently, and the failure");
        Console.WriteLine("  you get depends on which primitive you picked for reasons that");
        Console.WriteLine("  probably had nothing to do with reentrancy.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: order these by contention =====");
        Console.WriteLine();
        Console.WriteLine("  8 threads, 4,096 counters, identical work:");
        Console.WriteLine();
        Console.WriteLine("  scheme                contentions   relative time");
        var g = Contended(new Global());
        Row("one global lock", g, g);
        Row("16 stripes", Contended(new Striped(16)), g);
        Row("one lock per counter", Contended(new PerKey()), g);
        Console.WriteLine();
        Console.WriteLine("  Contention falls by orders of magnitude; time falls far less. That");
        Console.WriteLine("  gap is the real lesson: removing contention helps only up to the");
        Console.WriteLine("  point where something else is the bottleneck, and here the remaining");
        Console.WriteLine("  cost is the atomic operation itself plus memory traffic.");
        Console.WriteLine();
        Console.WriteLine("  So finer locking has diminishing returns AND rising risk — every");
        Console.WriteLine("  extra lock is another thing that can be taken out of order. Start");
        Console.WriteLine("  with one lock and stripe only when a profiler says to.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: fix this without deadlocking =====");
        Console.WriteLine();
        Console.WriteLine("      void Transfer(Account a, Account b, decimal amt)");
        Console.WriteLine("      { lock (a.Gate) lock (b.Gate) { ... } }");
        Console.WriteLine();
        Console.WriteLine("  Called concurrently as Transfer(A,B) and Transfer(B,A):");
        Console.WriteLine();
        Console.WriteLine($"    naive           : {TransferTrial(ordered: false)}");
        Console.WriteLine($"    ordered by id   : {TransferTrial(ordered: true)}");
        Console.WriteLine();
        Console.WriteLine("  Acquire in a total order every caller agrees on:");
        Console.WriteLine();
        Console.WriteLine("      var (first, second) = a.Id < b.Id ? (a, b) : (b, a);");
        Console.WriteLine("      lock (first.Gate) lock (second.Gate) { ... }");
        Console.WriteLine();
        Console.WriteLine("  A cycle requires two threads acquiring in OPPOSITE orders. If every");
        Console.WriteLine("  thread uses the same order, no cycle can form. That is a proof, not a");
        Console.WriteLine("  reduction in probability.");
        Console.WriteLine();
        Console.WriteLine("  The ordering key must be stable and total: a database id works, an");
        Console.WriteLine("  object hash code does not (it can collide and can change between");
        Console.WriteLine("  runs). And the rule only holds if every path goes through the ordered");
        Console.WriteLine("  helper — one method that forgets reopens the cycle.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: which stall is this? =====");
        Console.WriteLine();
        Console.WriteLine("  Four services, all slow, all with low CPU. Name each from counters:");
        Console.WriteLine();
        Console.WriteLine("  contention   CPU    threads   queue    diagnosis");
        Console.WriteLine("  HIGH+rising  low    steady    rising   lock held too long");
        Console.WriteLine("  FLAT         ~zero  steady    rising   deadlock: nobody is competing");
        Console.WriteLine("  low          low    RISING    rising   sync-over-async (t2-07)");
        Console.WriteLine("  low          100%   steady    rising   parallel saturation (t2-10)");
        Console.WriteLine();
        Console.WriteLine("  The contention counter separates the first two, and it is the one");
        Console.WriteLine("  people never look at. A deadlock produces a FLAT contention count");
        Console.WriteLine("  because the stuck threads have stopped competing for anything — they");
        Console.WriteLine("  are parked, not fighting.");
        Console.WriteLine();
        Console.WriteLine("  Thread count separates sync-over-async: the pool keeps injecting");
        Console.WriteLine("  replacements for threads it believes are merely slow.");
        Console.WriteLine();
        Console.WriteLine("  Then confirm with a dump: syncblk shows a CYCLE for a deadlock and a");
        Console.WriteLine("  QUEUE (one owner, many waiters) for a long critical section.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static string Elsewhere() => "ledger-gate";

    // --- Exercise 2 -----------------------------------------------------------
    static double Scope(bool inside)
    {
        var gate = new object();
        var map = new Dictionary<int, long>();
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();

        for (var t = 0; t < 8; t++)
        {
            var seed = t;
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                for (var i = 0; i < 3_000; i++)
                {
                    var key = seed * 3_000 + i;
                    if (inside) { lock (gate) { map[key] = Compute(key); } }
                    else { var r = Compute(key); lock (gate) { map[key] = r; } }
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();
        _sink += map.Count;
        return sw.Elapsed.TotalMilliseconds;
    }

    static long Compute(int seed)
    {
        var h = seed;
        for (var i = 0; i < 400; i++) h = HashCode.Combine(h, i);
        return h & 0xFF;
    }

    // --- Exercise 3 -----------------------------------------------------------
    static readonly object NestGate = new();

    static string Nested()
    {
        lock (NestGate)
        {
            lock (NestGate) { return "entered twice, no deadlock"; }
        }
    }

    static string SemaphoreNested()
    {
        var sem = new SemaphoreSlim(1, 1);
        sem.Wait();
        var second = sem.Wait(TimeSpan.FromMilliseconds(200));
        if (second) { sem.Release(); sem.Release(); return "entered twice (unexpected)"; }
        sem.Release();
        return "DEADLOCKED on the second Wait (timed out at 200 ms)";
    }

    // --- Exercise 4 -----------------------------------------------------------
    interface ICounters { void Inc(int k); long Total { get; } }

    sealed class Global : ICounters
    {
        readonly object _g = new(); readonly long[] _c = new long[4096];
        public void Inc(int k) { lock (_g) _c[k]++; }
        public long Total => _c.Sum();
    }

    sealed class Striped : ICounters
    {
        readonly object[] _g; readonly long[] _c = new long[4096];
        public Striped(int n) { _g = new object[n]; for (var i = 0; i < n; i++) _g[i] = new object(); }
        public void Inc(int k) { lock (_g[k & (_g.Length - 1)]) _c[k]++; }
        public long Total => _c.Sum();
    }

    sealed class PerKey : ICounters
    {
        readonly object[] _g = new object[4096]; readonly long[] _c = new long[4096];
        public PerKey() { for (var i = 0; i < 4096; i++) _g[i] = new object(); }
        public void Inc(int k) { lock (_g[k]) _c[k]++; }
        public long Total => _c.Sum();
    }

    readonly record struct Cont(long Contentions, double Ms);

    static Cont Contended(ICounters c)
    {
        Thread.Sleep(100);
        var before = Monitor.LockContentionCount;
        var sw = Stopwatch.StartNew();
        var threads = new Thread[8];
        var ready = new ManualResetEventSlim(false);
        for (var t = 0; t < 8; t++)
        {
            var seed = t * 7919;
            threads[t] = new Thread(() =>
            {
                ready.Wait();
                var k = seed;
                for (var i = 0; i < 150_000; i++)
                {
                    k = (k * 1103515245 + 12345) & int.MaxValue;
                    c.Inc(k % 4096);
                }
            });
            threads[t].Start();
        }
        ready.Set();
        foreach (var th in threads) th.Join();
        sw.Stop();
        _sink += c.Total;
        return new Cont(Monitor.LockContentionCount - before, sw.Elapsed.TotalMilliseconds);
    }

    static void Row(string label, Cont r, Cont baseline) =>
        Console.WriteLine($"  {label,-20} {r.Contentions,11:N0}   {r.Ms / baseline.Ms,13:N2}x");

    // --- Exercise 5 -----------------------------------------------------------
    sealed class Account
    {
        public Account(int id) { Id = id; }
        public int Id { get; }
        public decimal Balance = 1000m;
        public object Gate { get; } = new();
    }

    static string TransferTrial(bool ordered)
    {
        var a = new Account(1);
        var b = new Account(2);
        var bothHoldOne = new CountdownEvent(2);
        var done = new CountdownEvent(2);

        void Transfer(Account from, Account to)
        {
            var (first, second) = ordered
                ? (from.Id < to.Id ? from : to, from.Id < to.Id ? to : from)
                : (from, to);
            lock (first.Gate)
            {
                bothHoldOne.Signal();
                bothHoldOne.Wait(200);
                lock (second.Gate) { from.Balance -= 100m; to.Balance += 100m; }
            }
            done.Signal();
        }

        new Thread(() => { try { Transfer(a, b); } catch { } }) { IsBackground = true }.Start();
        new Thread(() => { try { Transfer(b, a); } catch { } }) { IsBackground = true }.Start();

        return done.Wait(1500)
            ? $"completed (A={a.Balance}, B={b.Balance})"
            : "DEADLOCKED";
    }
}
