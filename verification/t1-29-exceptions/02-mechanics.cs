// 02-mechanics.cs — the two-pass model, which is the only way to explain why an
// exception filter runs BEFORE the finally blocks between the throw and the
// handler. Plus throw vs throw ex, and the order everything actually happens in.
// .NET 10.0.400. Run: dotnet run 02-mechanics.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static readonly List<string> Log = new();

    static void Main()
    {
        Console.WriteLine("--- the two-pass model, observed ---");
        Log.Clear();
        try
        {
            try
            {
                try
                {
                    Log.Add("throw");
                    throw new InvalidOperationException("boom");
                }
                finally
                {
                    Log.Add("inner finally");
                }
            }
            finally
            {
                Log.Add("outer finally");
            }
        }
        catch (InvalidOperationException) when (Filter())
        {
            Log.Add("handler");
        }
        foreach (var line in Log) Console.WriteLine($"  {line}");
        Console.WriteLine("  The FILTER ran before both finally blocks. That is the whole");
        Console.WriteLine("  reason exception handling is two passes:");
        Console.WriteLine("    pass 1 — walk up the stack running filters, to FIND a handler");
        Console.WriteLine("    pass 2 — unwind, running finally blocks, then run the handler");
        Console.WriteLine("  If no filter accepts, pass 2 never happens and the process");
        Console.WriteLine("  dies with the stack intact — which is why a crash dump from an");
        Console.WriteLine("  unhandled exception shows the throwing frame, not the catcher.");

        Console.WriteLine();
        Console.WriteLine("--- throw vs throw ex: the stack trace ---");
        Console.WriteLine("  rethrow with 'throw;'");
        foreach (var line in TraceOf(() => Rethrow())) Console.WriteLine($"    {line}");
        Console.WriteLine("  rethrow with 'throw ex;'");
        foreach (var line in TraceOf(() => RethrowResetting())) Console.WriteLine($"    {line}");
        Console.WriteLine("  'throw ex' resets the trace to the rethrow point. The frame");
        Console.WriteLine("  where it actually failed is gone, permanently.");

        Console.WriteLine();
        Console.WriteLine("  and the third option, wrapping:");
        foreach (var line in TraceOf(() => Wrap())) Console.WriteLine($"    {line}");

        Console.WriteLine();
        Console.WriteLine("--- a filter can observe without handling ---");
        var observed = new List<string>();
        try
        {
            try
            {
                throw new TimeoutException("gateway timed out");
            }
            catch (Exception ex) when (Observe(ex, observed))
            {
                Console.WriteLine("  (never reached)");
            }
        }
        catch (TimeoutException)
        {
            Console.WriteLine($"  outer handler caught it; the filter logged: {observed[0]}");
        }
        Console.WriteLine("  A filter that returns false does not handle the exception, and");
        Console.WriteLine("  it runs with the original stack still intact — so it can log");
        Console.WriteLine("  state that unwinding would have destroyed.");

        Console.WriteLine();
        Console.WriteLine("--- catch order: first MATCH wins, not most specific ---");
        foreach (var ex in new Exception[]
                 {
                     new ArgumentNullException("p"),
                     new ArgumentException("a"),
                     new InvalidOperationException("i")
                 })
        {
            Console.WriteLine($"  {ex.GetType().Name,-28} -> {Classify(ex)}");
        }
        Console.WriteLine("  ArgumentNullException derives from ArgumentException, so an");
        Console.WriteLine("  ArgumentException arm placed first catches both. The compiler");
        Console.WriteLine("  DOES stop this: CS0160 if the order is provably wrong.");

        Console.WriteLine();
        Console.WriteLine("--- finally runs on return, and can change the answer ---");
        Console.WriteLine($"  ReturnsFromTry()      : {ReturnsFromTry()}");
        Console.WriteLine($"  FinallyCannotOverride(): {FinallyCannotOverride()}");
        Console.WriteLine("  The return value is computed BEFORE finally runs, so a finally");
        Console.WriteLine("  that mutates the returned variable does not change the result.");
        Console.WriteLine("  ('return' inside finally is CS0157 — the language forbids it.)");

        Console.WriteLine();
        Console.WriteLine("--- an exception thrown IN a finally replaces the original ---");
        try
        {
            try
            {
                throw new InvalidOperationException("the real problem");
            }
            finally
            {
                throw new TimeoutException("the cleanup problem");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  caught : {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"  inner  : {ex.InnerException?.Message ?? "(none)"}");
        }
        Console.WriteLine("  The original exception is GONE — not wrapped, not inner, gone.");
        Console.WriteLine("  This is why cleanup code must not throw, and why Dispose");
        Console.WriteLine("  implementations that can fail cause unexplainable incidents.");

        Console.WriteLine();
        Console.WriteLine("--- AggregateException flattens, but only when asked ---");
        var agg = new AggregateException("two failed",
            new InvalidOperationException("first"),
            new AggregateException("nested", new TimeoutException("second")));
        Console.WriteLine($"  InnerExceptions.Count      : {agg.InnerExceptions.Count}");
        Console.WriteLine($"  Flatten().InnerExceptions  : {agg.Flatten().InnerExceptions.Count}");
        Console.WriteLine($"  flattened types            : " +
                          $"{string.Join(", ", agg.Flatten().InnerExceptions.Select(e => e.GetType().Name))}");
    }

    static bool Filter()
    {
        Log.Add("FILTER");
        return true;
    }

    static bool Observe(Exception ex, List<string> into)
    {
        into.Add($"{ex.GetType().Name}: {ex.Message}");
        return false;   // do not handle
    }

    static IEnumerable<string> TraceOf(Action a)
    {
        try { a(); }
        catch (Exception ex)
        {
            var lines = (ex.StackTrace ?? "").Split('\n')
                .Select(l => l.Trim())
                .Where(l => l.Length > 0 && !l.Contains("System."))
                .Take(4);
            var result = new List<string> { $"{ex.GetType().Name}: {ex.Message}" };
            result.AddRange(lines);
            if (ex.InnerException is { } inner)
                result.Add($"  inner: {inner.GetType().Name}: {inner.Message}");
            return result;
        }
        return new[] { "(did not throw)" };
    }

    static void Failing() => throw new InvalidOperationException("original failure");

    static void Rethrow()
    {
        try { Failing(); }
        catch (InvalidOperationException) { throw; }
    }

    // The analyser catches this one, and its message is the lesson:
    //   warning CA2200: Re-throwing caught exception changes stack information
    // Suppressed so the file builds clean while still demonstrating the damage.
#pragma warning disable CA2200
    static void RethrowResetting()
    {
        try { Failing(); }
        catch (InvalidOperationException ex) { throw ex; }
    }
#pragma warning restore CA2200

    static void Wrap()
    {
        try { Failing(); }
        catch (InvalidOperationException ex)
        {
            throw new ApplicationException("while settling batch 42", ex);
        }
    }

    static string Classify(Exception ex)
    {
        try { throw ex; }
        catch (ArgumentNullException) { return "null argument"; }
        catch (ArgumentException) { return "bad argument"; }
        catch (Exception) { return "other"; }
    }

    static int ReturnsFromTry()
    {
        try { return 1; }
        finally { Console.WriteLine("    (finally ran after the return value was computed)"); }
    }

    static int FinallyCannotOverride()
    {
        var value = 1;
        try { return value; }
        finally { value = 99; }
    }
}
