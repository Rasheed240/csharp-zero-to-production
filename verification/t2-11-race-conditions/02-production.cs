// 02-production.cs — Ledger's duplicate-payment bug. A check-then-act race that
// passed every test, survived nine months, and paid one supplier twice.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Payments;

public sealed record PaymentRequest(string IdempotencyKey, decimal Amount);

/// <summary>Stands in for the payment gateway. Counts how many times it charged.</summary>
public sealed class Gateway
{
    private int _charges;
    public int Charges => Volatile.Read(ref _charges);
    public void Reset() => Volatile.Write(ref _charges, 0);

    public void Charge(decimal amount) => Interlocked.Increment(ref _charges);
}

/// <summary>
/// THE BUG. Check, then act. Between the two, another thread can do the same.
/// </summary>
public sealed class PaymentServiceV1
{
    private readonly HashSet<string> _seen = new(StringComparer.Ordinal);
    private readonly Gateway _gateway;
    public PaymentServiceV1(Gateway gateway) => _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        if (_seen.Contains(request.IdempotencyKey)) return;   // CHECK
        _gateway.Charge(request.Amount);                      // ACT
        _seen.Add(request.IdempotencyKey);                    // and record
    }
}

/// <summary>A lock makes check-and-act one indivisible step.</summary>
public sealed class PaymentServiceV2
{
    private readonly HashSet<string> _seen = new(StringComparer.Ordinal);
    private readonly object _gate = new();
    private readonly Gateway _gateway;
    public PaymentServiceV2(Gateway gateway) => _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        lock (_gate)
        {
            if (!_seen.Add(request.IdempotencyKey)) return;    // Add returns false if present
            _gateway.Charge(request.Amount);
        }
    }
}

/// <summary>
/// Lock-free, using the atomic test-and-set that ConcurrentDictionary provides.
/// TryAdd is a single atomic operation: there is no gap to race in.
/// </summary>
public sealed class PaymentServiceV3
{
    private readonly ConcurrentDictionary<string, byte> _seen = new(StringComparer.Ordinal);
    private readonly Gateway _gateway;
    public PaymentServiceV3(Gateway gateway) => _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        if (!_seen.TryAdd(request.IdempotencyKey, 0)) return;
        _gateway.Charge(request.Amount);
    }
}

/// <summary>
/// WRONG in a subtle way: GetOrAdd's factory is NOT atomic. It can run more than
/// once for the same key under contention, so the charge can happen twice even
/// though only one entry ends up in the dictionary.
/// </summary>
public sealed class PaymentServiceV4
{
    private readonly ConcurrentDictionary<string, byte> _seen = new(StringComparer.Ordinal);
    private readonly Gateway _gateway;
    public PaymentServiceV4(Gateway gateway) => _gateway = gateway;

    public void Pay(PaymentRequest request)
    {
        _seen.GetOrAdd(request.IdempotencyKey, _ =>
        {
            _gateway.Charge(request.Amount);      // side effect inside the factory
            return 0;
        });
    }
}

class Program
{
    const int Attempts = 8;
    const int Trials = 200;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger deduplicates payments by idempotency key. A client that");
        Console.WriteLine("  retries a request must not be charged twice, so the service checks");
        Console.WriteLine("  whether it has seen the key before:");
        Console.WriteLine();
        Console.WriteLine("      if (_seen.Contains(key)) return;   // CHECK");
        Console.WriteLine("      _gateway.Charge(amount);           // ACT");
        Console.WriteLine("      _seen.Add(key);");
        Console.WriteLine();
        Console.WriteLine("  It is correct when read top to bottom, and it passed every test,");
        Console.WriteLine("  because every test called it one thread at a time.");
        Console.WriteLine();
        Console.WriteLine("  In production a client with an aggressive retry policy sent the same");
        Console.WriteLine("  request eight times in about 40 ms. A load balancer spread them");
        Console.WriteLine("  across threads. All eight passed the check before any of them");
        Console.WriteLine("  reached the Add.");
        Console.WriteLine();
        Console.WriteLine($"  {Trials} trials, {Attempts} simultaneous retries of the SAME key.");
        Console.WriteLine("  A correct service charges exactly once per trial.");
        Console.WriteLine();
        Console.WriteLine("  implementation                     charges   expected   double-charged");

        Trial("V1: check, then act", g => new PaymentServiceV1(g));
        Trial("V2: lock around both", g => new PaymentServiceV2(g));
        Trial("V3: ConcurrentDictionary.TryAdd", g => new PaymentServiceV3(g));
        Trial("V4: GetOrAdd with a side effect", g => new PaymentServiceV4(g));

        Console.WriteLine();
        Console.WriteLine("  V1 is the shipped bug. The window between the check and the record is");
        Console.WriteLine("  a few nanoseconds wide, which is why nine months of traffic passed");
        Console.WriteLine("  through it without incident — and why one client's retry storm went");
        Console.WriteLine("  straight through it.");
        Console.WriteLine();
        Console.WriteLine("  V1 has a SECOND defect the charge count does not show: HashSet<T> is");
        Console.WriteLine("  not thread-safe, so concurrent Add calls can corrupt its buckets.");
        Console.WriteLine("  The observable result of that is a later Contains returning false for");
        Console.WriteLine("  a key that was added, or an infinite loop inside the lookup. The");
        Console.WriteLine("  duplicate charge is the symptom people noticed; the corrupted set is");
        Console.WriteLine("  the one that would have been harder to explain.");
        Console.WriteLine();
        Console.WriteLine("  V4 is the interesting failure. It LOOKS lock-free and correct, and it");
        Console.WriteLine("  uses a thread-safe collection. But ConcurrentDictionary.GetOrAdd does");
        Console.WriteLine("  not promise the factory runs once — it promises one VALUE wins. Under");
        Console.WriteLine("  contention the factory can run several times, and here the factory");
        Console.WriteLine("  charges the card.");
        Console.WriteLine();
        Console.WriteLine("  That is the general rule worth carrying: a thread-safe COLLECTION does");
        Console.WriteLine("  not make your OPERATION atomic. It makes each of its own methods");
        Console.WriteLine("  atomic. Anything you compose from two of them is a new operation with");
        Console.WriteLine("  a new gap.");

        Console.WriteLine();
        Console.WriteLine("=== why the tests passed ===");
        Console.WriteLine();
        var single = SingleThreaded();
        Console.WriteLine($"  V1 called 8 times SEQUENTIALLY : {single} charge(s)");
        Console.WriteLine("  Correct. Every unit test in the suite looked like this.");
        Console.WriteLine();
        Console.WriteLine("  A race needs two things a normal test does not provide: genuine");
        Console.WriteLine("  concurrency, and enough repetitions for an unlikely interleaving to");
        Console.WriteLine("  occur. A single concurrent trial frequently passes too — which is why");
        Console.WriteLine("  the table above runs 200 of them and reports how many failed rather");
        Console.WriteLine("  than asserting on one.");
        Console.WriteLine();
        Console.WriteLine("  The test that would have caught it:");
        Console.WriteLine();
        Console.WriteLine("      for (var trial = 0; trial < 200; trial++)");
        Console.WriteLine("      {");
        Console.WriteLine("          var gateway = new Gateway();");
        Console.WriteLine("          var service = new PaymentService(gateway);");
        Console.WriteLine("          var key = Guid.NewGuid().ToString();");
        Console.WriteLine();
        Console.WriteLine("          Parallel.For(0, 8, _ => service.Pay(new(key, 100m)));");
        Console.WriteLine();
        Console.WriteLine("          Assert.Equal(1, gateway.Charges);");
        Console.WriteLine("      }");
        Console.WriteLine();
        Console.WriteLine("  The loop count is not decoration. A race that fires 5% of the time");
        Console.WriteLine("  passes a single-trial test 19 times out of 20 and will be marked");
        Console.WriteLine("  flaky and retried rather than investigated.");

        Console.WriteLine();
        Console.WriteLine("=== how it was diagnosed ===");
        Console.WriteLine();
        Console.WriteLine("  There is no counter for 'this happened twice'. What surfaced it was a");
        Console.WriteLine("  supplier's complaint, then a query:");
        Console.WriteLine();
        Console.WriteLine("      SELECT idempotency_key, COUNT(*)");
        Console.WriteLine("      FROM charges GROUP BY idempotency_key HAVING COUNT(*) > 1;");
        Console.WriteLine();
        Console.WriteLine("  That query is the real lesson. A race on a business invariant is");
        Console.WriteLine("  invisible to every runtime metric you have — no exception, no latency");
        Console.WriteLine("  change, no memory signature — and visible in the DATA. If an");
        Console.WriteLine("  invariant matters, assert it in the data continuously, because that");
        Console.WriteLine("  is the only place a race of this kind leaves a trace.");
        Console.WriteLine();
        Console.WriteLine("  Better still, make the database enforce it: a unique index on");
        Console.WriteLine("  idempotency_key turns a silent duplicate into a constraint violation");
        Console.WriteLine("  you can catch and handle. In-process locking protects one instance;");
        Console.WriteLine("  the moment you run two replicas, only the database can arbitrate.");
        Console.WriteLine();
        Console.WriteLine("  Note what that means for V2 and V3 above: both are correct WITHIN a");
        Console.WriteLine("  process and neither is sufficient across a horizontally scaled");
        Console.WriteLine("  deployment. The lock is per-instance. Two pods have two locks.");
    }

    static void Trial(string label, Func<Gateway, object> make)
    {
        var doubleCharged = 0;
        var totalCharges = 0;

        for (var trial = 0; trial < Trials; trial++)
        {
            var gateway = new Gateway();
            var service = make(gateway);
            var key = $"KEY-{trial}";
            var request = new PaymentRequest(key, 100m);

            var ready = new ManualResetEventSlim(false);
            var threads = new Thread[Attempts];
            for (var i = 0; i < Attempts; i++)
            {
                threads[i] = new Thread(() =>
                {
                    ready.Wait();                     // start together, to widen the window
                    try { Invoke(service, request); }
                    catch { /* a corrupted HashSet can throw; counted as a failure below */ }
                });
                threads[i].Start();
            }
            ready.Set();
            foreach (var t in threads) t.Join();

            totalCharges += gateway.Charges;
            if (gateway.Charges != 1) doubleCharged++;
        }

        Console.WriteLine($"  {label,-33} {totalCharges,8:N0}   {Trials,8:N0}   " +
                          $"{doubleCharged,8:N0} of {Trials}");
    }

    static void Invoke(object service, PaymentRequest r)
    {
        switch (service)
        {
            case PaymentServiceV1 v1: v1.Pay(r); break;
            case PaymentServiceV2 v2: v2.Pay(r); break;
            case PaymentServiceV3 v3: v3.Pay(r); break;
            case PaymentServiceV4 v4: v4.Pay(r); break;
        }
    }

    static int SingleThreaded()
    {
        var gateway = new Gateway();
        var service = new PaymentServiceV1(gateway);
        var request = new PaymentRequest("KEY-SEQ", 100m);
        for (var i = 0; i < 8; i++) service.Pay(request);
        return gateway.Charges;
    }
}
