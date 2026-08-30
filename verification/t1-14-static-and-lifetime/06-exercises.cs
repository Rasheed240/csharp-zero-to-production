// 06-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 06-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;

// ===== Exercise 2 ==========================================================
static class Probe { public static string Mark(string s) { Console.WriteLine($"    init {s}"); return s; } }

class NoStaticCtor
{
    public static readonly string Field = Probe.Mark("NoStaticCtor.Field");
    public static void Ping() => Console.WriteLine("    NoStaticCtor.Ping()");
}

class WithStaticCtor
{
    public static readonly string Field = Probe.Mark("WithStaticCtor.Field");
    static WithStaticCtor() { }
    public static void Ping() => Console.WriteLine("    WithStaticCtor.Ping()");
}

// ===== Exercise 3 ==========================================================
sealed class PoisonedByStaticCtor
{
    public static readonly string Value;
    static PoisonedByStaticCtor()
    {
        var v = Environment.GetEnvironmentVariable("CSPREP_MISSING_VAR");
        Value = v ?? throw new InvalidOperationException("CSPREP_MISSING_VAR is not set");
    }
}

sealed class CachingLazy
{
    private static readonly Lazy<string> _value = new(() =>
    {
        var v = Environment.GetEnvironmentVariable("CSPREP_MISSING_VAR");
        return v ?? throw new InvalidOperationException("CSPREP_MISSING_VAR is not set");
    }, LazyThreadSafetyMode.ExecutionAndPublication);

    public static string Value => _value.Value;
}

sealed class RetryingLazy
{
    // PublicationOnly is the ONLY mode that does not cache a failure.
    private static readonly Lazy<string> _value = new(() =>
    {
        var v = Environment.GetEnvironmentVariable("CSPREP_MISSING_VAR");
        return v ?? throw new InvalidOperationException("CSPREP_MISSING_VAR is not set");
    }, LazyThreadSafetyMode.PublicationOnly);

    public static string Value => _value.Value;
}

// ===== Exercise 4 ==========================================================
static class BadTotals { public static decimal Total; }

sealed class GoodTotals
{
    private decimal _total;
    public void Add(decimal amount) => _total += amount;
    public decimal Total => _total;
}

class Program
{
    static async Task Main()
    {
        Console.WriteLine("===== Exercise 2: beforefieldinit =====");
        foreach (var t in new[] { typeof(NoStaticCtor), typeof(WithStaticCtor) })
            Console.WriteLine($"  {t.Name,-15} BeforeFieldInit=" +
                              $"{(t.Attributes & TypeAttributes.BeforeFieldInit) != 0}");
        Console.WriteLine("  calling Ping() on each (neither reads a static field):");
        NoStaticCtor.Ping();
        WithStaticCtor.Ping();
        Console.WriteLine("  now reading the fields:");
        Console.WriteLine($"    {NoStaticCtor.Field}");
        Console.WriteLine($"    {WithStaticCtor.Field}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: recovery after a failed initialisation =====");
        Environment.SetEnvironmentVariable("CSPREP_MISSING_VAR", null);

        for (int attempt = 1; attempt <= 2; attempt++)
        {
            if (attempt == 2) Environment.SetEnvironmentVariable("CSPREP_MISSING_VAR", "now-set");
            try
            {
                Console.WriteLine($"  {"static constructor",-28} attempt {attempt}: {PoisonedByStaticCtor.Value}");
            }
            catch (TypeInitializationException ex)
            {
                Console.WriteLine($"  {"static constructor",-28} attempt {attempt}: " +
                                  $"{ex.GetType().Name} (inner {ex.InnerException?.GetType().Name})");
            }
        }

        RunLazy("Lazy ExecutionAndPublication", () => CachingLazy.Value);
        RunLazy("Lazy PublicationOnly", () => RetryingLazy.Value);

        Environment.SetEnvironmentVariable("CSPREP_MISSING_VAR", null);

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: two tests sharing one slot =====");
        BadTotals.Total = 0m;
        await Task.WhenAll(
            Task.Run(() => { for (int i = 0; i < 3; i++) BadTotals.Total += 10m; }),
            Task.Run(() => { for (int i = 0; i < 3; i++) BadTotals.Total += 10m; }));
        Console.WriteLine($"  one static slot, two concurrent 'tests' adding 30 each -> {BadTotals.Total}");
        Console.WriteLine("    each test expects 30; together they neither isolate nor reliably total 60");

        var t1 = new GoodTotals();
        var t2 = new GoodTotals();
        await Task.WhenAll(
            Task.Run(() => { for (int i = 0; i < 3; i++) t1.Add(10m); }),
            Task.Run(() => { for (int i = 0; i < 3; i++) t2.Add(10m); }));
        Console.WriteLine($"  instance fields -> t1={t1.Total}, t2={t2.Total}");
    }

    static void RunLazy(string label, Func<string> read)
    {
        Environment.SetEnvironmentVariable("CSPREP_MISSING_VAR", null);
        for (int attempt = 1; attempt <= 2; attempt++)
        {
            if (attempt == 2) Environment.SetEnvironmentVariable("CSPREP_MISSING_VAR", "now-set");
            try { Console.WriteLine($"  {label,-28} attempt {attempt}: {read()}"); }
            catch (Exception ex)
            { Console.WriteLine($"  {label,-28} attempt {attempt}: {ex.GetType().Name}"); }
        }
        Environment.SetEnvironmentVariable("CSPREP_MISSING_VAR", null);
    }
}
