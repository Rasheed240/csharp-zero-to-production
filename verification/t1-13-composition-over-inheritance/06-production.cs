// 06-production.cs — composition as it actually appears in a service: small
// pieces, assembled once at startup from configuration, with the assembly
// itself being the thing you can test.
// .NET 10.0.400. Run: dotnet run 06-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct ChargeRequest(string OrderId, decimal Amount, string Currency);
public readonly record struct ChargeResult(bool Ok, string Detail, int Attempts);

public interface ICharger { ChargeResult Charge(ChargeRequest request); }

// ---- the one piece that talks to the outside world ------------------------
public sealed class GatewayCharger : ICharger
{
    private readonly Func<ChargeRequest, bool> _gateway;
    private int _calls;
    public int Calls => _calls;

    public GatewayCharger(Func<ChargeRequest, bool> gateway) => _gateway = gateway;

    public ChargeResult Charge(ChargeRequest r)
    {
        _calls++;
        return _gateway(r)
            ? new ChargeResult(true, "gateway accepted", 1)
            : new ChargeResult(false, "gateway declined", 1);
    }
}

// ---- each concern is one small class that holds an ICharger ---------------
public sealed class RetryingCharger : ICharger
{
    private readonly ICharger _inner;
    private readonly int _maxAttempts;

    public RetryingCharger(ICharger inner, int maxAttempts)
    {
        _inner = inner;
        _maxAttempts = maxAttempts < 1
            ? throw new ArgumentOutOfRangeException(nameof(maxAttempts))
            : maxAttempts;
    }

    public ChargeResult Charge(ChargeRequest r)
    {
        ChargeResult last = default;
        for (int attempt = 1; attempt <= _maxAttempts; attempt++)
        {
            last = _inner.Charge(r);
            if (last.Ok) return last with { Attempts = attempt };
        }
        return last with { Attempts = _maxAttempts };
    }
}

public sealed class ValidatingCharger : ICharger
{
    private static readonly HashSet<string> Supported =
        new(StringComparer.OrdinalIgnoreCase) { "GBP", "EUR", "USD" };
    private readonly ICharger _inner;
    public ValidatingCharger(ICharger inner) => _inner = inner;

    public ChargeResult Charge(ChargeRequest r)
    {
        if (r.Amount <= 0m) return new ChargeResult(false, "amount must be positive", 0);
        if (!Supported.Contains(r.Currency))
            return new ChargeResult(false, $"unsupported currency {r.Currency}", 0);
        return _inner.Charge(r);
    }
}

public sealed class AuditingCharger : ICharger
{
    private readonly ICharger _inner;
    private readonly IList<string> _audit;
    public AuditingCharger(ICharger inner, IList<string> audit) => (_inner, _audit) = (inner, audit);

    public ChargeResult Charge(ChargeRequest r)
    {
        var result = _inner.Charge(r);
        _audit.Add($"{r.OrderId} {r.Amount:0.00} {r.Currency} -> " +
                   $"{(result.Ok ? "ok" : "failed")} ({result.Detail}) after {result.Attempts}");
        return result;
    }
}

public sealed class IdempotentCharger : ICharger
{
    private readonly ICharger _inner;
    private readonly Dictionary<string, ChargeResult> _seen = new();
    public IdempotentCharger(ICharger inner) => _inner = inner;

    public ChargeResult Charge(ChargeRequest r)
    {
        if (_seen.TryGetValue(r.OrderId, out var cached))
            return cached with { Detail = cached.Detail + " (replayed)" };
        var result = _inner.Charge(r);
        _seen[r.OrderId] = result;
        return result;
    }
}

// ---- the assembly is data, and is the part worth testing ------------------
public sealed record ChargerOptions(bool Validate, int MaxAttempts, bool Audit, bool Idempotent);

public static class ChargerFactory
{
    // Order matters and is explicit here rather than implied by a class hierarchy.
    public static ICharger Build(
        Func<ChargeRequest, bool> gateway, ChargerOptions options, IList<string> audit)
    {
        ICharger charger = new GatewayCharger(gateway);
        if (options.MaxAttempts > 1) charger = new RetryingCharger(charger, options.MaxAttempts);
        if (options.Validate) charger = new ValidatingCharger(charger);
        if (options.Audit) charger = new AuditingCharger(charger, audit);
        if (options.Idempotent) charger = new IdempotentCharger(charger);
        return charger;
    }
}

class Program
{
    static void Main()
    {
        var audit = new List<string>();
        int calls = 0;

        // A gateway that fails twice then succeeds, per order.
        var failures = new Dictionary<string, int>();
        bool Gateway(ChargeRequest r)
        {
            calls++;
            failures.TryGetValue(r.OrderId, out int n);
            failures[r.OrderId] = n + 1;
            return n >= 2;
        }

        var charger = ChargerFactory.Build(
            Gateway,
            new ChargerOptions(Validate: true, MaxAttempts: 3, Audit: true, Idempotent: true),
            audit);

        Show(charger.Charge(new ChargeRequest("O-1", 25.00m, "GBP")));
        Show(charger.Charge(new ChargeRequest("O-1", 25.00m, "GBP")));   // replayed
        Show(charger.Charge(new ChargeRequest("O-2", -5.00m, "GBP")));
        Show(charger.Charge(new ChargeRequest("O-3", 10.00m, "JPY")));

        Console.WriteLine();
        Console.WriteLine($"gateway calls made: {calls}");
        Console.WriteLine("audit:");
        foreach (var a in audit) Console.WriteLine($"  {a}");

        Console.WriteLine();
        Console.WriteLine("--- the same pieces, a different configuration ---");
        var audit2 = new List<string>();
        var minimal = ChargerFactory.Build(
            _ => true,
            new ChargerOptions(Validate: false, MaxAttempts: 1, Audit: false, Idempotent: false),
            audit2);
        Show(minimal.Charge(new ChargeRequest("O-9", -1m, "XXX")));
        Console.WriteLine($"  audit entries: {audit2.Count} (auditing was switched off)");
        Console.WriteLine("  and a negative amount in an unsupported currency went through,");
        Console.WriteLine("  because validation is a layer rather than a base-class rule.");
    }

    static void Show(ChargeResult r) =>
        Console.WriteLine($"  ok={r.Ok,-5} attempts={r.Attempts} {r.Detail}");
}
