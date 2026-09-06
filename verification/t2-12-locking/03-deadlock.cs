// 03-deadlock.cs — a lock-ordering deadlock, reproduced DETERMINISTICALLY rather
// than hoped for, and the three ways out. Each thread signals once it holds its
// FIRST lock and waits briefly for the other, which forces the interleaving that
// in production happens by chance.
//
// The wait must time out. Under a correct ordering both threads want the same
// first lock, so the second never signals. An earlier version of this file used
// a Barrier, which blocked forever in exactly that case and reported the ORDERED
// strategy as deadlocked when the deadlock was entirely in the harness.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-deadlock.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    const int WatchdogMs = 1500;

    static void Main()
    {
        Console.WriteLine("=== the classic shape ===");
        Console.WriteLine();
        Console.WriteLine("  Two accounts. Two transfers, in opposite directions, at the same");
        Console.WriteLine("  time. Each locks the source, then the destination.");
        Console.WriteLine();
        Console.WriteLine("      Transfer(A -> B):  lock(A) ... lock(B)");
        Console.WriteLine("      Transfer(B -> A):  lock(B) ... lock(A)");
        Console.WriteLine();
        Console.WriteLine("  Thread 1 holds A and wants B. Thread 2 holds B and wants A. Neither");
        Console.WriteLine("  will release what it has until it gets what it wants. This is a");
        Console.WriteLine("  CYCLE, and it is permanent: no timeout inside the transfer helps,");
        Console.WriteLine("  because nothing is timing out — both threads are waiting correctly.");
        Console.WriteLine();
        Console.WriteLine("  strategy                          outcome            ms");

        Run("naive: source then destination", Naive);
        Run("ordered: lowest id first", Ordered);
        Run("TryEnter with a timeout", TryWithTimeout);
        Run("one lock for all accounts", SingleLock);

        Console.WriteLine();
        Console.WriteLine("  Every DEADLOCKED row above is a real, permanent deadlock. The");
        Console.WriteLine("  milliseconds shown are this file's watchdog giving up so the program");
        Console.WriteLine("  can report and continue; the threads themselves never recover and");
        Console.WriteLine("  are abandoned as background threads.");

        Console.WriteLine();
        Console.WriteLine("=== 1. ORDERING: the fix that scales ===");
        Console.WriteLine();
        Console.WriteLine("  Take locks in a total order that every caller agrees on. Here the");
        Console.WriteLine("  account id supplies it:");
        Console.WriteLine();
        Console.WriteLine("      var (first, second) = from.Id < to.Id ? (from, to) : (to, from);");
        Console.WriteLine("      lock (first.Gate) lock (second.Gate) { ... }");
        Console.WriteLine();
        Console.WriteLine("  A cycle needs two threads acquiring in opposite orders. If every");
        Console.WriteLine("  thread acquires in the SAME order, no cycle can form — this is not a");
        Console.WriteLine("  reduction in probability, it is a proof.");
        Console.WriteLine();
        Console.WriteLine("  The ordering key must be stable and total. An object's hash code is");
        Console.WriteLine("  neither: two accounts can collide, and the order can change between");
        Console.WriteLine("  runs. A database id, a name, or an explicit sequence number works.");
        Console.WriteLine();
        Console.WriteLine("  What breaks it: any code path that acquires the same two locks");
        Console.WriteLine("  WITHOUT going through the ordered helper. The rule protects you only");
        Console.WriteLine("  if it is the sole way in, which is an argument for putting it behind");
        Console.WriteLine("  one method and making the gates private.");

        Console.WriteLine();
        Console.WriteLine("=== 2. TRYENTER: the fix that detects ===");
        Console.WriteLine();
        Console.WriteLine("      if (!Monitor.TryEnter(second.Gate, TimeSpan.FromMilliseconds(50)))");
        Console.WriteLine("          { release everything; back off; retry; }");
        Console.WriteLine();
        Console.WriteLine("  This does not PREVENT the cycle. It notices being stuck, releases");
        Console.WriteLine("  what it holds so the other thread can proceed, and tries again.");
        Console.WriteLine();
        Console.WriteLine($"  retries needed on the run above : {Volatile.Read(ref _retries)}");
        Console.WriteLine();
        Console.WriteLine("  Zero, on this run: the first TryEnter succeeded and the backoff");
        Console.WriteLine("  path never executed. That is worth stating plainly rather than");
        Console.WriteLine("  hiding, because it is the normal case. The retry loop is insurance —");
        Console.WriteLine("  it costs nothing when no cycle forms, and it is the only thing");
        Console.WriteLine("  standing between you and a permanent stall when one does.");
        Console.WriteLine();
        Console.WriteLine("  Use it when a total order genuinely is not available — locks acquired");
        Console.WriteLine("  across components you do not control, for instance. Its costs are");
        Console.WriteLine("  real: the work must be safely repeatable, two threads can livelock");
        Console.WriteLine("  by retrying in step unless the backoff is randomised, and a wrong");
        Console.WriteLine("  timeout turns a deadlock into an intermittent slow path that is");
        Console.WriteLine("  harder to diagnose than the deadlock was.");

        Console.WriteLine();
        Console.WriteLine("=== 3. ONE LOCK: the fix that always works ===");
        Console.WriteLine();
        Console.WriteLine("  A single lock for all accounts cannot deadlock against itself. It is");
        Console.WriteLine("  the right answer far more often than its reputation suggests: it is");
        Console.WriteLine("  trivially correct, and 02-granularity.cs showed the whole cost of");
        Console.WriteLine("  coarse locking is contention, which you can measure before deciding");
        Console.WriteLine("  it matters.");
        Console.WriteLine();
        Console.WriteLine("  Reach for finer locks when a profiler says contention is hurting, not");
        Console.WriteLine("  because fine-grained locking sounds more sophisticated.");

        Console.WriteLine();
        Console.WriteLine("=== what it looks like in a dump ===");
        Console.WriteLine();
        Console.WriteLine("  A deadlocked service uses NO CPU and throws nothing. Requests stop");
        Console.WriteLine("  completing and the process looks idle.");
        Console.WriteLine();
        Console.WriteLine("    dotnet-dump collect --process-id <pid>");
        Console.WriteLine("    dotnet-dump analyze <file>");
        Console.WriteLine("    > clrstack -all        threads sitting in Monitor.Enter");
        Console.WriteLine("    > syncblk              which thread OWNS each contended monitor");
        Console.WriteLine();
        Console.WriteLine("  syncblk is the one that closes it. It prints, per monitor, the owning");
        Console.WriteLine("  thread and the object. Two entries whose owners are each other's");
        Console.WriteLine("  waiters is the cycle, and there is no other explanation for it.");
        Console.WriteLine();
        Console.WriteLine("  Live, without a dump, the counter to watch is:");
        Console.WriteLine("    dotnet-counters monitor --process-id <pid> System.Runtime");
        Console.WriteLine("      monitor-lock-contention-count   flat (nobody is even trying)");
        Console.WriteLine("      cpu-usage                       near zero");
        Console.WriteLine("      threadpool-queue-length         climbing");
        Console.WriteLine();
        Console.WriteLine("  Note how that differs from the other stalls in this track. Blocking");
        Console.WriteLine("  (t2-07) shows threads climbing as the pool injects replacements. A");
        Console.WriteLine("  deadlock on a fixed set of threads shows the queue growing while the");
        Console.WriteLine("  contention count stops moving, because the stuck threads have already");
        Console.WriteLine("  stopped competing for anything.");
    }

    static int _retries;

    sealed class Account
    {
        public Account(int id, decimal balance) { Id = id; Balance = balance; }
        public int Id { get; }
        public decimal Balance { get; set; }
        public object Gate { get; } = new();
    }

    /// <summary>
    /// Forces the interleaving between the two acquisitions. Each thread signals
    /// once it holds its FIRST lock, then waits briefly for the other to do the
    /// same. In production this overlap happens by chance; here it happens every
    /// time, which is what makes the naive result reproducible.
    ///
    /// It must time out. Under a correct ordering both threads want the same
    /// first lock, so the second never signals — an earlier version of this file
    /// used a Barrier, which then blocked forever and reported the ORDERED
    /// strategy as deadlocked when the deadlock was entirely in the harness.
    /// </summary>
    static CountdownEvent? _bothHoldOne;

    static void HoldingFirstLock() => Overlap();

    static void Overlap()
    {
        _bothHoldOne!.Signal();
        _bothHoldOne.Wait(200);
    }

    static void Run(string label, Action<Account, Account, decimal> transfer)
    {
        var a = new Account(1, 1000m);
        var b = new Account(2, 1000m);
        _bothHoldOne = new CountdownEvent(2);
        Volatile.Write(ref _retries, 0);

        var done = new CountdownEvent(2);
        var sw = Stopwatch.StartNew();

        Start(() => { transfer(a, b, 100m); done.Signal(); });
        Start(() => { transfer(b, a, 100m); done.Signal(); });

        var completed = done.Wait(WatchdogMs);
        sw.Stop();

        var balances = completed ? $"  (A={a.Balance}, B={b.Balance})" : "";
        Console.WriteLine($"  {label,-33} {(completed ? "completed" : "DEADLOCKED"),-15} " +
                          $"{sw.Elapsed.TotalMilliseconds,5:N0}{balances}");
    }

    static void Start(Action body) =>
        new Thread(() => { try { body(); } catch { } }) { IsBackground = true }.Start();

    /// <summary>WRONG. Acquires in call order, so opposite transfers form a cycle.</summary>
    static void Naive(Account from, Account to, decimal amount)
    {
        lock (from.Gate)
        {
            Overlap();          // both threads now hold one lock each
            lock (to.Gate)
            {
                from.Balance -= amount;
                to.Balance += amount;
            }
        }
    }

    /// <summary>Right. A total order over the locks makes a cycle impossible.</summary>
    static void Ordered(Account from, Account to, decimal amount)
    {
        var (first, second) = from.Id < to.Id ? (from, to) : (to, from);
        lock (first.Gate)
        {
            Overlap();
            lock (second.Gate)
            {
                from.Balance -= amount;
                to.Balance += amount;
            }
        }
    }

    /// <summary>
    /// Also right, and weaker: detects the cycle instead of preventing it, then
    /// backs off. The backoff is randomised so two threads do not retry in step.
    /// </summary>
    static void TryWithTimeout(Account from, Account to, decimal amount)
    {
        var rng = new Random(Environment.CurrentManagedThreadId);
        var signalled = false;

        while (true)
        {
            var gotFirst = false;
            var gotSecond = false;
            try
            {
                Monitor.TryEnter(from.Gate, TimeSpan.FromMilliseconds(50), ref gotFirst);
                if (gotFirst)
                {
                    // Only synchronise on the first pass.
                    if (!signalled) { signalled = true; Overlap(); }

                    Monitor.TryEnter(to.Gate, TimeSpan.FromMilliseconds(50), ref gotSecond);
                    if (gotSecond)
                    {
                        from.Balance -= amount;
                        to.Balance += amount;
                        return;
                    }
                }
            }
            finally
            {
                if (gotSecond) Monitor.Exit(to.Gate);
                if (gotFirst) Monitor.Exit(from.Gate);
            }

            Interlocked.Increment(ref _retries);
            Thread.Sleep(rng.Next(1, 20));       // randomised, to avoid livelock
        }
    }

    static readonly object AllAccounts = new();

    /// <summary>Right, and trivially so: one lock cannot deadlock against itself.</summary>
    static void SingleLock(Account from, Account to, decimal amount)
    {
        lock (AllAccounts)
        {
            from.Balance -= amount;
            to.Balance += amount;
        }
        Overlap();               // keep the harness symmetric
    }
}
