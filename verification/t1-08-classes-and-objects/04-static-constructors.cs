// Demo 4 — static constructors run once, lazily, and if one throws the type is
// unusable for the rest of the process.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. a static constructor runs LAZILY, on first use");
Console.WriteLine("   (nothing has touched Settings yet)");
Console.WriteLine($"   about to read Settings.Timeout...");
Console.WriteLine($"   Settings.Timeout = {Settings.Timeout}");
Console.WriteLine($"   reading it again = {Settings.Timeout}   (constructor did not run twice)");
Console.WriteLine();

Console.WriteLine("2. it runs exactly once, even from many threads");
Parallel.For(0, 8, i => { if (Counter.Value < 0) { Console.WriteLine(i); } });
Console.WriteLine($"   Counter static constructor ran {Counter.TimesConstructed} time(s)");
Console.WriteLine("   The runtime guarantees this, with no lock written by you.");
Console.WriteLine();

Console.WriteLine("3. a static constructor that THROWS poisons the type PERMANENTLY");
Console.WriteLine("   (LEDGER_CONNECTION_STRING is deliberately not set)");
Console.WriteLine();

Attempt("first use");

Console.WriteLine();
Console.WriteLine("   now FIXING the cause at run time and trying again:");
Environment.SetEnvironmentVariable("LEDGER_CONNECTION_STRING", "Server=db;Database=ledger");

Attempt("after fixing the environment variable");
Attempt("and again");

Console.WriteLine();
Console.WriteLine("   The static constructor ran exactly ONCE and is never retried. Fixing");
Console.WriteLine("   the underlying cause does not help: the runtime cached the failure and");
Console.WriteLine("   every later use of the type replays it. Only restarting the process");
Console.WriteLine("   clears it.");
Console.WriteLine();
Console.WriteLine("   Note the real cause is in InnerException, not the message you first");
Console.WriteLine("   see. TypeInitializationException always wraps it.");

static void Attempt(string label)
{
    try
    {
        Console.WriteLine($"   {label}: value = {BadConfig.ConnectionString}");
    }
    catch (TypeInitializationException ex)
    {
        Console.WriteLine($"   {label}: {ex.GetType().Name}");
        Console.WriteLine($"      inner -> {ex.InnerException?.GetType().Name}: {ex.InnerException?.Message}");
    }
}

// ---------------------------------------------------------------------------

static class Settings
{
    static Settings()
    {
        Console.WriteLine("   >> Settings static constructor running");
        Timeout = TimeSpan.FromSeconds(30);
    }

    public static TimeSpan Timeout { get; }
}

static class Counter
{
    private static int _timesConstructed;

    static Counter()
    {
        Interlocked.Increment(ref _timesConstructed);
        Value = 42;
    }

    public static int Value { get; }

    public static int TimesConstructed => _timesConstructed;
}

static class BadConfig
{
    static BadConfig()
    {
        // Exactly what a real config class does, and exactly how it fails when
        // the environment variable is missing.
        string? raw = Environment.GetEnvironmentVariable("LEDGER_CONNECTION_STRING");

        if (string.IsNullOrWhiteSpace(raw))
        {
            throw new InvalidOperationException(
                "LEDGER_CONNECTION_STRING is not set.");
        }

        ConnectionString = raw;
    }

    public static string ConnectionString { get; } = string.Empty;
}
