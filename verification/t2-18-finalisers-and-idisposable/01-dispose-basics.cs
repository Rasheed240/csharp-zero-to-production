// 01-dispose-basics.cs — What "using" compiles to, the order things are disposed
// in, and the difference between deterministic cleanup and collection.
//
// Run:  dotnet run 01-dispose-basics.cs -c Release
//
// EXACT vs RATIO: every result in this file is deterministic. The ORDER of the
// printed lines is the whole point; there are no timings to be noisy.

Console.WriteLine("1. using is try/finally, and the finally always runs");
Console.WriteLine();

TryFinallyEquivalence();
DisposeOrder();
UsingDeclarationScope();
ExceptionDuringUse();
DisposeIsNotCollection();
DoubleDispose();

// ---------------------------------------------------------------------------
static void TryFinallyEquivalence()
{
    Console.WriteLine("   with a using statement:");
    using (var a = new Tracked("A"))
    {
        Console.WriteLine("     body running");
    }

    Console.WriteLine();
    Console.WriteLine("   the exact equivalent, written out:");
    var b = new Tracked("B");
    try
    {
        Console.WriteLine("     body running");
    }
    finally
    {
        // The compiler emits a null check, because the expression could be null
        // for a reference type. Disposing null is a no-op, not an exception.
        b?.Dispose();
    }

    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void DisposeOrder()
{
    Console.WriteLine("2. Nested resources are disposed in REVERSE order");
    Console.WriteLine();

    using (var outer = new Tracked("outer"))
    using (var middle = new Tracked("middle"))
    using (var inner = new Tracked("inner"))
    {
        Console.WriteLine("     all three open");
    }

    Console.WriteLine();
    Console.WriteLine("   This matters when the inner one writes THROUGH the outer one.");
    Console.WriteLine("   A StreamWriter wrapping a FileStream must flush before the file");
    Console.WriteLine("   handle closes, and reverse order is what guarantees it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void UsingDeclarationScope()
{
    Console.WriteLine("3. A using DECLARATION disposes at the end of the enclosing scope");
    Console.WriteLine();

    Console.WriteLine("   entering block");
    {
        using var scoped = new Tracked("scoped");
        Console.WriteLine("     inside block");
    }
    Console.WriteLine("   left block");
    Console.WriteLine();
    Console.WriteLine("   Note it disposed at the closing brace of the BLOCK, not the method.");
    Console.WriteLine("   A using declaration at method level lives until the method returns,");
    Console.WriteLine("   which is longer than people expect inside a loop body.");
    Console.WriteLine();

    Console.WriteLine("   in a loop, each iteration disposes its own:");
    for (int i = 0; i < 3; i++)
    {
        using var perIteration = new Tracked($"iteration-{i}");
    }
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void ExceptionDuringUse()
{
    Console.WriteLine("4. Dispose runs even when the body throws");
    Console.WriteLine();

    try
    {
        using var resource = new Tracked("throws");
        throw new InvalidOperationException("something failed");
    }
    catch (InvalidOperationException ex)
    {
        Console.WriteLine($"     caught: {ex.Message}");
    }

    Console.WriteLine();
    Console.WriteLine("   The dispose line appears BEFORE the catch line, because finally");
    Console.WriteLine("   runs while the exception is still propagating.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void DisposeIsNotCollection()
{
    Console.WriteLine("5. Dispose does NOT free memory, and collection does NOT call Dispose");
    Console.WriteLine();

    var held = new Tracked("still-referenced");
    held.Dispose();

    Console.WriteLine($"     after Dispose, object still exists : {held.Name}");
    Console.WriteLine($"     still in generation                : {GC.GetGeneration(held)}");
    Console.WriteLine();

    // The reverse: drop a reference without disposing.
    MakeAndAbandon();
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    Console.WriteLine($"     abandoned without Dispose, disposals seen: {Tracked.DisposeCount("abandoned")}");
    Console.WriteLine();
    Console.WriteLine("   Zero. Nothing in the runtime calls Dispose for you. The garbage");
    Console.WriteLine("   collector reclaims MEMORY; it knows nothing about file handles,");
    Console.WriteLine("   sockets, or database connections.");
    Console.WriteLine();

    GC.KeepAlive(held);

    static void MakeAndAbandon()
    {
        var doomed = new Tracked("abandoned", quiet: true);
    }
}

// ---------------------------------------------------------------------------
static void DoubleDispose()
{
    Console.WriteLine("6. Dispose must be safe to call twice");
    Console.WriteLine();

    var resource = new Tracked("twice");
    resource.Dispose();
    resource.Dispose();
    resource.Dispose();

    Console.WriteLine($"     Dispose called 3 times, cleanup ran {Tracked.DisposeCount("twice")} time(s)");
    Console.WriteLine();
    Console.WriteLine("   This is required by the IDisposable contract, not a nicety. A using");
    Console.WriteLine("   statement around an object you also dispose by hand will call it");
    Console.WriteLine("   twice, and that must not throw.");
}

// ---------------------------------------------------------------------------
sealed class Tracked : IDisposable
{
    private static readonly Dictionary<string, int> Counts = new();

    private readonly bool _quiet;
    private bool _disposed;

    public Tracked(string name, bool quiet = false)
    {
        Name = name;
        _quiet = quiet;
        if (!quiet)
        {
            Console.WriteLine($"     open    {name}");
        }
    }

    public string Name { get; }

    public static int DisposeCount(string name) => Counts.TryGetValue(name, out int n) ? n : 0;

    public void Dispose()
    {
        // The guard is what makes a second call harmless.
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Counts[Name] = DisposeCount(Name) + 1;

        if (!_quiet)
        {
            Console.WriteLine($"     dispose {Name}");
        }
    }
}
