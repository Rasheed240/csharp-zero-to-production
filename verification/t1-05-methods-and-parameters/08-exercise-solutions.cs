// Worked solutions from exercises 2, 3 and 4, verified.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// --- Exercise 2: the rewritten Payments API ------------------------------
Console.WriteLine("Exercise 2 - Payments.Settle");
Money amount = new Money(100m, "USD");
Console.WriteLine($"  Settle(100 USD, 0.02)         -> {Payments.Settle(amount, 0.02m)}");
Console.WriteLine($"  currency survives             -> {Payments.Settle(amount, 0.02m).Currency}");

try
{
    Payments.Settle(amount, 1.5m);
}
catch (ArgumentOutOfRangeException)
{
    Console.WriteLine("  Settle(100 USD, 1.5) rejected -> ArgumentOutOfRangeException");
}
Console.WriteLine();

// --- Exercise 3: bounded recursion and the iterative walk ----------------
Console.WriteLine("Exercise 3 - CategoryWalker");

Category root = new Category("root", new List<Category>
{
    new Category("a", new List<Category> { new Category("a1", new List<Category>()) }),
    new Category("b", new List<Category>())
});

CategoryWalker walker = new CategoryWalker();
walker.Walk(root);
Console.WriteLine($"  bounded recursion visited     -> {string.Join(",", walker.Visited)}");

CategoryWalker iterative = new CategoryWalker();
iterative.WalkIteratively(root);
Console.WriteLine($"  iterative visited             -> {string.Join(",", iterative.Visited)}");

// A cycle: 'a' lists root as its own child.
Category cyclicRoot = new Category("root", new List<Category>());
Category cyclicChild = new Category("a", new List<Category> { cyclicRoot });
cyclicRoot.Children.Add(cyclicChild);

try
{
    new CategoryWalker().Walk(cyclicRoot);
}
catch (InvalidOperationException ex)
{
    Console.WriteLine($"  cycle detected                -> {ex.Message}");
}

try
{
    new CategoryWalker().WalkIteratively(cyclicRoot);
}
catch (InvalidOperationException ex)
{
    Console.WriteLine($"  cycle detected (iterative)    -> {ex.Message}");
}
Console.WriteLine();

// --- Exercise 4: the sentinel-plus-runtime-lookup fee library ------------
Console.WriteLine("Exercise 4 - Fees with a run-time default");
Console.WriteLine($"  default from library          -> {Fees.CurrentDefaultPercent()}%");
Console.WriteLine($"  ApplyFee(100m)                -> {Fees.ApplyFee(100m)}");
Console.WriteLine($"  ApplyFee(100m, 2)  (explicit) -> {Fees.ApplyFee(100m, 2)}");

Fees.ConfigureDefaultPercent(static () => 7);
Console.WriteLine("  ...host reconfigures to 7% at run time, with no rebuild:");
Console.WriteLine($"  default from library          -> {Fees.CurrentDefaultPercent()}%");
Console.WriteLine($"  ApplyFee(100m)                -> {Fees.ApplyFee(100m)}");
Console.WriteLine($"  ApplyFee(100m, 2)  (explicit) -> {Fees.ApplyFee(100m, 2)}");

try
{
    Fees.ApplyFee(100m, 200);
}
catch (ArgumentOutOfRangeException)
{
    Console.WriteLine("  ApplyFee(100m, 200) rejected  -> ArgumentOutOfRangeException");
}

// ---------------------------------------------------------------------------

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() =>
        Amount.ToString("0.00", CultureInfo.InvariantCulture) + " " + Currency;
}

public sealed record SettlementRequest(
    Money Amount,
    decimal FeeRate,
    bool Notify = true,
    IReadOnlyList<string>? Tags = null);

public static class Payments
{
    public static Money Settle(Money amount, decimal feeRate) =>
        Settle(new SettlementRequest(amount, feeRate));

    public static Money Settle(SettlementRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.FeeRate < 0m || request.FeeRate > 1m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(request), request.FeeRate, "Fee rate must be between 0 and 1.");
        }

        decimal fee = Math.Round(
            request.Amount.Amount * request.FeeRate, 2, MidpointRounding.AwayFromZero);

        return new Money(request.Amount.Amount - fee, request.Amount.Currency);
    }
}

public sealed class Category
{
    public Category(string id, List<Category> children)
    {
        Id = id;
        Children = children;
    }

    public string Id { get; }
    public List<Category> Children { get; }
}

public sealed class CategoryWalker
{
    private const int MaxDepth = 64;

    public List<string> Visited { get; } = new List<string>();

    public void Walk(Category category, int depth = 0, HashSet<string>? seen = null)
    {
        ArgumentNullException.ThrowIfNull(category);

        if (depth > MaxDepth)
        {
            throw new InvalidOperationException(
                $"Category tree deeper than {MaxDepth} at '{category.Id}'; likely malformed.");
        }

        seen ??= new HashSet<string>(StringComparer.Ordinal);

        if (!seen.Add(category.Id))
        {
            throw new InvalidOperationException($"Cycle detected at category '{category.Id}'.");
        }

        Visited.Add(category.Id);

        foreach (Category child in category.Children)
        {
            Walk(child, depth + 1, seen);
        }
    }

    public void WalkIteratively(Category root)
    {
        ArgumentNullException.ThrowIfNull(root);

        HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
        Stack<Category> pending = new Stack<Category>();
        pending.Push(root);

        while (pending.Count > 0)
        {
            Category category = pending.Pop();

            if (!seen.Add(category.Id))
            {
                throw new InvalidOperationException($"Cycle detected at category '{category.Id}'.");
            }

            Visited.Add(category.Id);

            foreach (Category child in category.Children)
            {
                pending.Push(child);
            }
        }
    }
}

public static class Fees
{
    /// <summary>
    /// Passed by callers that want the current default rate rather than a
    /// specific one. Kept forever: old assemblies were compiled with a literal
    /// and must continue to resolve to this method.
    /// </summary>
    public const int UseCurrentDefault = -1;

    private static volatile Func<int> _defaultPercentSource = static () => 5;

    /// <summary>Set by the host at startup, from configuration.</summary>
    public static void ConfigureDefaultPercent(Func<int> source)
    {
        ArgumentNullException.ThrowIfNull(source);
        _defaultPercentSource = source;
    }

    public static int CurrentDefaultPercent() => _defaultPercentSource();

    public static decimal ApplyFee(decimal amount, int feePercent = UseCurrentDefault)
    {
        // Shipped WITHOUT a special case for the old baked-in literal 2, because
        // an old caller's 2 is indistinguishable from a deliberate 2.
        int effective = feePercent == UseCurrentDefault
            ? CurrentDefaultPercent()
            : feePercent;

        if (effective < 0 || effective > 100)
        {
            throw new ArgumentOutOfRangeException(
                nameof(feePercent), feePercent, "Fee percent must be between 0 and 100.");
        }

        return amount + (amount * effective / 100m);
    }
}
