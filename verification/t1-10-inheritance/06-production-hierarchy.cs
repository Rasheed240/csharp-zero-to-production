// 06-production-hierarchy.cs — inheritance used the way it survives contact
// with other people: the base owns the algorithm and the invariants, and the
// derived class fills in exactly one step.
// .NET 10.0.400. Run: dotnet run 06-production-hierarchy.cs

using System;
using System.Collections.Generic;

public abstract class PaymentProcessor
{
    // PRIVATE, not protected. A subclass cannot corrupt the audit trail.
    private readonly List<string> _audit = new();
    private int _attempts;

    public string MerchantId { get; }
    public IReadOnlyList<string> Audit => _audit;
    public int Attempts => _attempts;

    protected PaymentProcessor(string merchantId)
    {
        if (string.IsNullOrWhiteSpace(merchantId))
            throw new ArgumentException("Merchant id is required.", nameof(merchantId));
        MerchantId = merchantId;
    }

    // The algorithm. NOT virtual: subclasses cannot reorder or skip the steps,
    // so the invariants below hold for every subclass that will ever exist.
    public PaymentResult Process(decimal amount, string reference)
    {
        if (amount <= 0m)
            return Fail(reference, "Amount must be positive.");
        if (string.IsNullOrWhiteSpace(reference))
            return Fail(reference, "Reference is required.");

        _attempts++;
        _audit.Add($"attempt {_attempts}: {Name} {amount:0.00} ref={reference}");

        try
        {
            var outcome = Authorise(amount, reference);   // the one open step
            _audit.Add($"  -> {(outcome.Approved ? "approved" : "declined")}: {outcome.Detail}");
            return outcome.Approved
                ? PaymentResult.Ok(reference, outcome.Detail)
                : PaymentResult.Declined(reference, outcome.Detail);
        }
        catch (Exception ex)
        {
            // A subclass that throws cannot take the audit trail down with it.
            _audit.Add($"  -> error: {ex.GetType().Name}");
            return PaymentResult.Error(reference, ex.GetType().Name);
        }
    }

    private PaymentResult Fail(string reference, string why)
    {
        _audit.Add($"rejected before attempt: {why}");
        return PaymentResult.Declined(reference, why);
    }

    // What a subclass must supply, and the only thing it may supply.
    protected abstract string Name { get; }
    protected abstract Authorisation Authorise(decimal amount, string reference);

    protected readonly record struct Authorisation(bool Approved, string Detail);
}

public readonly record struct PaymentResult(string Reference, string Status, string Detail)
{
    public static PaymentResult Ok(string r, string d) => new(r, "approved", d);
    public static PaymentResult Declined(string r, string d) => new(r, "declined", d);
    public static PaymentResult Error(string r, string d) => new(r, "error", d);
}

public sealed class CardProcessor : PaymentProcessor
{
    private readonly decimal _floorLimit;

    public CardProcessor(string merchantId, decimal floorLimit) : base(merchantId)
        => _floorLimit = floorLimit;

    protected override string Name => "card";

    protected override Authorisation Authorise(decimal amount, string reference) =>
        amount <= _floorLimit
            ? new Authorisation(true, "under floor limit")
            : new Authorisation(false, $"over floor limit of {_floorLimit:0.00}");
}

public sealed class BankTransferProcessor : PaymentProcessor
{
    public BankTransferProcessor(string merchantId) : base(merchantId) { }

    protected override string Name => "transfer";

    protected override Authorisation Authorise(decimal amount, string reference)
    {
        if (reference.StartsWith("BAD", StringComparison.Ordinal))
            throw new InvalidOperationException("Upstream bank rejected the reference.");
        return new Authorisation(true, "same-day clearing");
    }
}

class Program
{
    static void Main()
    {
        var card = new CardProcessor("M-1", floorLimit: 100m);
        Show(card.Process(50m, "REF-1"));
        Show(card.Process(500m, "REF-2"));
        Show(card.Process(-5m, "REF-3"));

        Console.WriteLine();
        Console.WriteLine($"card attempts recorded: {card.Attempts}");
        foreach (var line in card.Audit) Console.WriteLine($"  {line}");

        Console.WriteLine();
        var bank = new BankTransferProcessor("M-1");
        Show(bank.Process(250m, "REF-4"));
        Show(bank.Process(250m, "BAD-REF"));

        Console.WriteLine();
        Console.WriteLine($"transfer attempts recorded: {bank.Attempts}");
        foreach (var line in bank.Audit) Console.WriteLine($"  {line}");

        Console.WriteLine();
        Console.WriteLine("A subclass that throws still leaves a complete audit trail,");
        Console.WriteLine("because the trail is written by the base and is not reachable");
        Console.WriteLine("from the subclass at all.");
    }

    static void Show(PaymentResult r) =>
        Console.WriteLine($"{r.Reference,-8} {r.Status,-9} {r.Detail}");
}
