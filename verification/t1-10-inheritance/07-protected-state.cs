// 07-protected-state.cs — protected is not encapsulation. Every subclass, now
// and forever, becomes part of the code that can break your invariants.
// .NET 10.0.400. Run: dotnet run 07-protected-state.cs

using System;
using System.Collections.Generic;

// ---- the tempting version -------------------------------------------------
class LeakyLedger
{
    protected readonly List<decimal> Entries = new();
    protected decimal RunningTotal;

    public decimal Total => RunningTotal;
    public int Count => Entries.Count;

    public void Post(decimal amount)
    {
        Entries.Add(amount);
        RunningTotal += amount;
    }
}

class DiscountLedger : LeakyLedger
{
    // Written by someone who wanted "post without affecting the total".
    // Reasonable-looking, and it silently breaks the class invariant.
    public void PostMemo(decimal amount) => Entries.Add(amount);

    public void ApplyCorrection(decimal delta) => RunningTotal += delta;
}

// ---- the version a subclass cannot break ----------------------------------
class SealedLedger
{
    private readonly List<decimal> _entries = new();
    private decimal _runningTotal;

    public decimal Total => _runningTotal;
    public int Count => _entries.Count;

    public void Post(decimal amount)
    {
        _entries.Add(amount);
        _runningTotal += amount;
    }

    // The extension point is a decision, not the storage.
    protected virtual bool ShouldPost(decimal amount) => true;

    public bool TryPost(decimal amount)
    {
        if (!ShouldPost(amount)) return false;
        Post(amount);
        return true;
    }

    public bool InvariantHolds()
    {
        decimal sum = 0m;
        foreach (var e in _entries) sum += e;
        return sum == _runningTotal;
    }
}

class SmallOnlyLedger : SealedLedger
{
    protected override bool ShouldPost(decimal amount) => amount <= 100m;
}

class Program
{
    static void Main()
    {
        var leaky = new DiscountLedger();
        leaky.Post(100m);
        leaky.PostMemo(50m);
        leaky.ApplyCorrection(-25m);

        Console.WriteLine("protected state, subclass free to touch it:");
        Console.WriteLine($"  entries: {leaky.Count}, total: {leaky.Total}");
        Console.WriteLine($"  invariant (sum of entries == total)? {leaky.Total == 125m}");
        Console.WriteLine("  the base class has no way to notice, and no way to prevent it");

        Console.WriteLine();
        var safe = new SmallOnlyLedger();
        Console.WriteLine("private state, subclass gets a decision instead:");
        Console.WriteLine($"  TryPost(50)  -> {safe.TryPost(50m)}");
        Console.WriteLine($"  TryPost(500) -> {safe.TryPost(500m)}");
        Console.WriteLine($"  entries: {safe.Count}, total: {safe.Total}");
        Console.WriteLine($"  invariant holds? {safe.InvariantHolds()}");
    }
}
