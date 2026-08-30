// 04-production.cs — delegates as the seam in a component: policy passed in,
// notifications passed out, and a pipeline built from functions.
// .NET 10.0.400. Run: dotnet run 04-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

public readonly record struct Payment(string Id, decimal Amount, string Currency);
public readonly record struct Decision(bool Approved, string Reason);

public sealed class PaymentAuthoriser
{
    // POLICY IN: a rule is a function. No interface, no class per rule.
    private readonly IReadOnlyList<(string Name, Func<Payment, Decision> Rule)> _rules;

    // CLOCK IN: the one dependency that would otherwise be static state.
    private readonly Func<DateTimeOffset> _now;

    // NOTIFICATIONS OUT: optional, so the field is nullable and raised safely.
    private Action<string>? _onDecision;

    public PaymentAuthoriser(
        IEnumerable<(string, Func<Payment, Decision>)> rules,
        Func<DateTimeOffset>? now = null)
    {
        _rules = rules.Select(r => (r.Item1, r.Item2)).ToArray();
        _now = now ?? (() => DateTimeOffset.UtcNow);
    }

    public void OnDecision(Action<string> handler) => _onDecision += handler;
    public void StopListening(Action<string> handler) => _onDecision -= handler;

    public Decision Authorise(Payment payment)
    {
        foreach (var (name, rule) in _rules)
        {
            Decision decision;
            try
            {
                decision = rule(payment);
            }
            catch (Exception ex)
            {
                decision = new Decision(false, $"rule '{name}' threw {ex.GetType().Name}");
            }

            if (!decision.Approved)
            {
                Raise($"{_now():HH:mm:ss} {payment.Id} declined by {name}: {decision.Reason}");
                return decision;
            }
        }

        Raise($"{_now():HH:mm:ss} {payment.Id} approved");
        return new Decision(true, "all rules passed");
    }

    // Raising safely: copy to a local, then null-check. ?.Invoke does both.
    private void Raise(string message) => _onDecision?.Invoke(message);
}

class Program
{
    static void Main()
    {
        var log = new List<string>();
        var fixedClock = () => new DateTimeOffset(2026, 8, 30, 9, 0, 0, TimeSpan.Zero);

        decimal floorLimit = 500m;
        var supported = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "GBP", "EUR" };

        var authoriser = new PaymentAuthoriser(new (string, Func<Payment, Decision>)[]
        {
            ("positive-amount", p => p.Amount > 0m
                ? new Decision(true, "")
                : new Decision(false, $"amount {p.Amount} is not positive")),

            ("supported-currency", p => supported.Contains(p.Currency)
                ? new Decision(true, "")
                : new Decision(false, $"{p.Currency} is not supported")),

            ("floor-limit", p => p.Amount <= floorLimit
                ? new Decision(true, "")
                : new Decision(false, $"{p.Amount} exceeds {floorLimit}"))
        }, fixedClock);

        Action<string> toLog = log.Add;
        authoriser.OnDecision(toLog);
        authoriser.OnDecision(m => Console.WriteLine($"  [console] {m}"));

        foreach (var p in new[]
        {
            new Payment("P-1", 100m, "GBP"),
            new Payment("P-2", -5m, "GBP"),
            new Payment("P-3", 100m, "JPY"),
            new Payment("P-4", 900m, "GBP")
        })
        {
            var d = authoriser.Authorise(p);
            Console.WriteLine($"  {p.Id}: approved={d.Approved}, {d.Reason}");
        }

        Console.WriteLine();
        Console.WriteLine($"log captured {log.Count} entries");

        Console.WriteLine();
        Console.WriteLine("--- unsubscribing works because we kept the reference ---");
        authoriser.StopListening(toLog);
        int before = log.Count;
        authoriser.Authorise(new Payment("P-5", 50m, "GBP"));
        Console.WriteLine($"  log entries after unsubscribing: {log.Count} (was {before})");
        Console.WriteLine("  The console handler was a lambda we did not keep, so it is still");
        Console.WriteLine("  attached and cannot be removed. That is the leak this module warns");
        Console.WriteLine("  about, and the subject of the events module.");

        Console.WriteLine();
        Console.WriteLine("--- a rule that throws is contained ---");
        var fragile = new PaymentAuthoriser(new (string, Func<Payment, Decision>)[]
        {
            ("always-throws", _ => throw new InvalidOperationException("upstream down"))
        }, fixedClock);
        var caught = fragile.Authorise(new Payment("P-9", 10m, "GBP"));
        Console.WriteLine($"  P-9: approved={caught.Approved}, {caught.Reason}");
        Console.WriteLine("  The authoriser caught it and turned it into a decision rather");
        Console.WriteLine("  than letting one rule take down the request.");

        Console.WriteLine();
        Console.WriteLine("--- composing functions ---");
        Func<decimal, decimal> vat = a => a * 1.20m;
        Func<decimal, decimal> voucher = a => a - 10m;      // a FLAT amount
        Func<decimal, decimal> round = a => Math.Round(a, 2);

        Console.WriteLine($"  voucher then VAT : {Compose(voucher, vat, round)(100.00m)}");
        Console.WriteLine($"  VAT then voucher : {Compose(vat, voucher, round)(100.00m)}");
        Console.WriteLine("  Different answers. Composing percentages alone would NOT show");
        Console.WriteLine("  this — multiplication commutes — which is worth knowing before");
        Console.WriteLine("  writing a test that proves nothing.");
    }

    static Func<T, T> Compose<T>(params Func<T, T>[] steps) =>
        input => steps.Aggregate(input, (acc, step) => step(acc));
}
