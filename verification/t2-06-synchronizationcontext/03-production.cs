// 03-production.cs — Ledger.Payments, a library shipped without
// ConfigureAwait(false), and what happened when a desktop team consumed it.
// Then the two things people get wrong about the fix: what it costs, and what
// it does to the ambient state your logging depends on.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace Ledger.Payments;

public sealed record Payment(string Reference, decimal Amount);
public sealed record Receipt(string Reference, string AuthCode);

/// <summary>Stands in for the remote card gateway.</summary>
public sealed class PaymentGateway
{
    public async Task<string> AuthoriseAsync(decimal amount, CancellationToken ct = default)
    {
        await Task.Delay(50, ct).ConfigureAwait(false);
        return $"AUTH-{amount:0}";
    }
}

/// <summary>
/// THE SHIPPED VERSION. A library method with a plain await. On a server this
/// behaves perfectly; in a UI host it deadlocks any caller that blocks.
/// </summary>
public sealed class PaymentServiceV1
{
    private readonly PaymentGateway _gateway;
    public PaymentServiceV1(PaymentGateway gateway) => _gateway = gateway;

    public async Task<Receipt> PayAsync(Payment payment, CancellationToken ct = default)
    {
        var code = await _gateway.AuthoriseAsync(payment.Amount, ct);   // captures
        return new Receipt(payment.Reference, code);
    }
}

/// <summary>THE FIX. Identical, except that no await captures a context.</summary>
public sealed class PaymentServiceV2
{
    private readonly PaymentGateway _gateway;
    public PaymentServiceV2(PaymentGateway gateway) => _gateway = gateway;

    public async Task<Receipt> PayAsync(Payment payment, CancellationToken ct = default)
    {
        var code = await _gateway.AuthoriseAsync(payment.Amount, ct).ConfigureAwait(false);
        return new Receipt(payment.Reference, code);
    }
}

class Program
{
    const int TimeoutMs = 1500;
    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger.Payments 3.2.0 shipped in March. Two hundred services use it");
        Console.WriteLine("  on ASP.NET Core with no reported problems in nine months.");
        Console.WriteLine("  In December the branch-operations team referenced the same package");
        Console.WriteLine("  from their WPF desktop till application. Clicking 'Take payment'");
        Console.WriteLine("  froze the window permanently. No exception, no log line, no CPU.");
        Console.WriteLine();
        Console.WriteLine("  Their call site, which is the ordinary shape for a click handler:");
        Console.WriteLine("      var receipt = _payments.PayAsync(payment).Result;");
        Console.WriteLine();

        var payment = new Payment("PAY-0001", 42.00m);
        Console.WriteLine("  host                      library version         result       ms");

        Measure("WPF (single-thread ctx)", "3.2.0 (plain await)", useContext: true,
            (done, ct) => new PaymentServiceV1(new PaymentGateway()).PayAsync(payment, ct));

        Measure("WPF (single-thread ctx)", "3.2.1 (ConfigureAwait)", useContext: true,
            (done, ct) => new PaymentServiceV2(new PaymentGateway()).PayAsync(payment, ct));

        Measure("ASP.NET Core (no ctx)", "3.2.0 (plain await)", useContext: false,
            (done, ct) => new PaymentServiceV1(new PaymentGateway()).PayAsync(payment, ct));

        Console.WriteLine();
        Console.WriteLine("  The library was never tested in a host that has a context, because");
        Console.WriteLine("  nobody who wrote it had ever used one. The bug was present from the");
        Console.WriteLine("  first release and undetectable for nine months.");
        Console.WriteLine();
        Console.WriteLine("  Read the first and third rows together. The SAME library code");
        Console.WriteLine("  deadlocks or does not depending entirely on the host application.");
        Console.WriteLine("  This is why the rule is about libraries, not about correctness:");
        Console.WriteLine("  a library does not know where it will run.");

        Console.WriteLine();
        Console.WriteLine("=== what ConfigureAwait(false) costs ===");
        Console.WriteLine();
        Console.WriteLine("  A common objection is that it clutters code for a theoretical gain.");
        Console.WriteLine("  Measured in a host with NO context, where it should be a no-op:");
        Console.WriteLine();
        Console.WriteLine("  variant                        bytes/call   ns/call");
        Console.WriteLine($"  plain await                    {Alloc(() => _sink += Plain().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() => _sink += Plain().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine($"  ConfigureAwait(false)          {Alloc(() => _sink += Configured().GetAwaiter().GetResult()),10}   " +
                          $"{Nanos(() => _sink += Configured().GetAwaiter().GetResult()),7:N0}");
        Console.WriteLine();
        Console.WriteLine("  Effectively identical, which is the expected result: with no context");
        Console.WriteLine("  to capture, the two paths do the same work. The cost of the rule is");
        Console.WriteLine("  typing, not performance.");

        Console.WriteLine();
        Console.WriteLine("=== the real cost: what you lose ===");
        Console.WriteLine();
        Console.WriteLine("  ConfigureAwait(false) abandons the SynchronizationContext. It does");
        Console.WriteLine("  NOT abandon ExecutionContext, which is what carries AsyncLocal<T> —");
        Console.WriteLine("  and AsyncLocal is what logging scopes, Activity/trace ids and");
        Console.WriteLine("  CultureInfo are built on. People conflate the two constantly.");
        Console.WriteLine();
        AsyncLocalSurvives().GetAwaiter().GetResult();

        Console.WriteLine();
        Console.WriteLine("  So a correlation id set before the await is still readable after it,");
        Console.WriteLine("  with or without ConfigureAwait(false). Your structured logging does");
        Console.WriteLine("  not break. What you lose is only the guarantee about WHICH THREAD");
        Console.WriteLine("  resumes you, which matters solely when a specific thread owns");
        Console.WriteLine("  something — a UI control, or a thread-affine COM object.");
    }

    static readonly AsyncLocal<string> Correlation = new();

    static async Task AsyncLocalSurvives()
    {
        Correlation.Value = "req-4f2a";
        Console.WriteLine($"  before any await               : {Correlation.Value}");

        await Task.Delay(10).ConfigureAwait(false);
        Console.WriteLine($"  after ConfigureAwait(false)    : {Correlation.Value}   " +
                          $"(thread {Environment.CurrentManagedThreadId})");

        await Task.Delay(10).ConfigureAwait(true);
        Console.WriteLine($"  after a plain await            : {Correlation.Value}   " +
                          $"(thread {Environment.CurrentManagedThreadId})");
    }

    static async Task<int> Plain()
    {
        await Task.CompletedTask;
        return 1;
    }

    static async Task<int> Configured()
    {
        await Task.CompletedTask.ConfigureAwait(false);
        return 1;
    }

    static void Measure(string host, string version, bool useContext,
                        Func<ManualResetEventSlim, CancellationToken, Task<Receipt>> call)
    {
        var done = new ManualResetEventSlim(false);
        var sw = Stopwatch.StartNew();
        SingleThreadContext? ctx = null;

        try
        {
            if (useContext)
            {
                ctx = new SingleThreadContext();
                ctx.Post(_ =>
                {
                    // The WPF click handler: blocking on the library's Task.
                    var receipt = call(done, CancellationToken.None).Result;
                    _sink += receipt.AuthCode.Length;
                    done.Set();
                }, null);
            }
            else
            {
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    var receipt = call(done, CancellationToken.None).Result;
                    _sink += receipt.AuthCode.Length;
                    done.Set();
                });
            }

            var completed = done.Wait(TimeoutMs);
            sw.Stop();
            Console.WriteLine($"  {host,-26} {version,-22} {(completed ? "ok" : "DEADLOCKED"),-11} " +
                              $"{sw.Elapsed.TotalMilliseconds,5:N0}");
        }
        finally
        {
            ctx?.Abandon();
        }
    }

    static long Alloc(Action a, int reps = 100_000)
    {
        for (var i = 0; i < 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < reps; i++) a();
        return (GC.GetAllocatedBytesForCurrentThread() - before) / reps;
    }

    static double Nanos(Action a, int reps = 100_000)
    {
        for (var i = 0; i < 1_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < reps; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / reps;
    }
}

/// <summary>A single-threaded SynchronizationContext, as WPF and WinForms provide.</summary>
sealed class SingleThreadContext : SynchronizationContext
{
    private readonly BlockingCollection<(SendOrPostCallback, object?)> _queue = new();

    public SingleThreadContext()
    {
        var thread = new Thread(Pump) { IsBackground = true, Name = "UI" };
        thread.Start();
    }

    private void Pump()
    {
        SetSynchronizationContext(this);
        foreach (var (callback, state) in _queue.GetConsumingEnumerable())
            callback(state);
    }

    public override void Post(SendOrPostCallback d, object? state) => _queue.Add((d, state));

    public void Abandon() => _queue.CompleteAdding();
}
