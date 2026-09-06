// 01-where-blocking-is-forced.cs — "async all the way up" is the right advice and
// it is not always possible. This file enumerates the five places C# gives you a
// synchronous signature you cannot change, and shows what to do at each one.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-where-blocking-is-forced.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static void Main()
    {
        Console.WriteLine("=== the five places you cannot await ===");
        Console.WriteLine();
        Console.WriteLine("  1. a constructor          — no async constructors exist in C#");
        Console.WriteLine("  2. a property getter      — a property is not allowed to be async");
        Console.WriteLine("  3. Dispose()              — the signature returns void");
        Console.WriteLine("  4. an interface you must  — someone else declared it as returning T");
        Console.WriteLine("     implement");
        Console.WriteLine("  5. an override            — the base class declared it synchronous");
        Console.WriteLine();
        Console.WriteLine("  In every one of these, the temptation is .Result. The fix is never");
        Console.WriteLine("  .Result; it is to move the asynchronous work somewhere it can be");
        Console.WriteLine("  awaited. Each case below shows how.");

        Console.WriteLine();
        Console.WriteLine("=== 1. the constructor: use a static async factory ===");
        Console.WriteLine();
        var service = LedgerClient.CreateAsync("https://ledger.internal").GetAwaiter().GetResult();
        Console.WriteLine($"  built via factory : {service.Describe()}");
        Console.WriteLine("  The constructor is private and takes the ALREADY-FETCHED data. The");
        Console.WriteLine("  fetching happens in a static async method that can await properly.");
        Console.WriteLine("  This is the single most useful pattern in this module, because a");
        Console.WriteLine("  constructor is where dependency injection puts you.");

        Console.WriteLine();
        Console.WriteLine("=== 2. the property: expose a method, not a property ===");
        Console.WriteLine();
        Console.WriteLine("  A property that does I/O is already a design error, async or not:");
        Console.WriteLine("  callers expect a property read to be cheap and side-effect free.");
        Console.WriteLine("  If it needs I/O, it is a method, and the method returns a Task.");
        Console.WriteLine();
        var gbp = service.GetRateAsync("GBP").GetAwaiter().GetResult();
        Console.WriteLine($"  rate via method   : {gbp}");

        Console.WriteLine();
        Console.WriteLine("=== 3. Dispose: implement IAsyncDisposable ===");
        Console.WriteLine();
        var conn = new LedgerConnection();
        conn.DisposeAsync().AsTask().GetAwaiter().GetResult();
        Console.WriteLine($"  disposed asynchronously, flushed {conn.Flushed} pending write(s)");
        Console.WriteLine("  await using replaces using. Implement BOTH interfaces only if some");
        Console.WriteLine("  callers genuinely cannot await; then the sync path must not block on");
        Console.WriteLine("  the async one — it needs its own synchronous implementation.");

        Console.WriteLine();
        Console.WriteLine("=== 4 and 5. an interface or override you do not control ===");
        Console.WriteLine();
        Console.WriteLine("  This is the genuinely hard case: the signature returns a value, you");
        Console.WriteLine("  cannot change it, and the work is asynchronous. Three real options,");
        Console.WriteLine("  in order of preference:");
        Console.WriteLine();
        Console.WriteLine("  (a) PRECOMPUTE. Do the async work before you are called, and have");
        Console.WriteLine("      the synchronous member read an already-populated field.");
        var validator = InvoiceValidator.LoadAsync().GetAwaiter().GetResult();
        var ok = validator.Validate("INV-1");
        Console.WriteLine($"      IValidator.Validate(...) -> {ok}  (no I/O at call time)");
        Console.WriteLine();
        Console.WriteLine("  (b) CHANGE THE ABSTRACTION. If you own the interface, make it async.");
        Console.WriteLine("      Most 'I cannot change it' cases turn out to be 'I did not want");
        Console.WriteLine("      to change six call sites'.");
        Console.WriteLine();
        Console.WriteLine("  (c) If it is genuinely fixed and precomputing is impossible, you are");
        Console.WriteLine("      choosing between two bad options and should choose deliberately:");
        Console.WriteLine("      see 02-the-bad-options.cs, which measures both.");

        Console.WriteLine();
        Console.WriteLine("=== the entry point is NOT one of these cases ===");
        Console.WriteLine();
        Console.WriteLine("  'Main cannot be async' has been false since C# 7.1. This compiles:");
        Console.WriteLine("      static async Task Main() { await RunAsync(); }");
        Console.WriteLine("  So does a top-level program with awaits in it. If your blocking call");
        Console.WriteLine("  is at the entry point, it is there by habit and not by necessity.");
    }
}

/// <summary>
/// The async factory pattern. The constructor is private and synchronous; a
/// static method does the awaiting and then calls it.
/// </summary>
public sealed class LedgerClient
{
    private readonly string _endpoint;
    private readonly IReadOnlyDictionary<string, decimal> _rates;

    private LedgerClient(string endpoint, IReadOnlyDictionary<string, decimal> rates)
    {
        _endpoint = endpoint;
        _rates = rates;
    }

    public static async Task<LedgerClient> CreateAsync(string endpoint, CancellationToken ct = default)
    {
        var rates = await FetchRatesAsync(ct).ConfigureAwait(false);
        return new LedgerClient(endpoint, rates);
    }

    private static async Task<IReadOnlyDictionary<string, decimal>> FetchRatesAsync(CancellationToken ct)
    {
        await Task.Delay(20, ct).ConfigureAwait(false);
        return new Dictionary<string, decimal> { ["GBP"] = 1.00m, ["EUR"] = 1.17m };
    }

    public string Describe() => $"LedgerClient({_endpoint}) with {_rates.Count} rates";

    /// <summary>A method, not a property, because it may do I/O.</summary>
    public async Task<decimal> GetRateAsync(string currency, CancellationToken ct = default)
    {
        if (_rates.TryGetValue(currency, out var cached)) return cached;
        await Task.Delay(10, ct).ConfigureAwait(false);
        return 1.00m;
    }
}

/// <summary>Cleanup that needs I/O implements IAsyncDisposable, not IDisposable.</summary>
public sealed class LedgerConnection : IAsyncDisposable
{
    private readonly List<string> _pending = new() { "write-1", "write-2" };
    public int Flushed { get; private set; }

    public async ValueTask DisposeAsync()
    {
        foreach (var _ in _pending)
        {
            await Task.Delay(5).ConfigureAwait(false);
            Flushed++;
        }
        _pending.Clear();
    }
}

public interface IValidator
{
    /// <summary>Synchronous by contract. We do not own this interface.</summary>
    bool Validate(string reference);
}

/// <summary>
/// Option (a): precompute. The async work happens in a factory; the synchronous
/// interface member reads a field and does no I/O at all.
/// </summary>
public sealed class InvoiceValidator : IValidator
{
    private readonly HashSet<string> _knownPrefixes;

    private InvoiceValidator(HashSet<string> knownPrefixes) => _knownPrefixes = knownPrefixes;

    public static async Task<InvoiceValidator> LoadAsync(CancellationToken ct = default)
    {
        await Task.Delay(20, ct).ConfigureAwait(false);
        return new InvoiceValidator(new HashSet<string>(StringComparer.Ordinal) { "INV", "CRN" });
    }

    public bool Validate(string reference)
    {
        var dash = reference.IndexOf('-');
        return dash > 0 && _knownPrefixes.Contains(reference[..dash]);
    }
}
