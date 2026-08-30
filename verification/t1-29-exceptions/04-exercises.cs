// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

class Program
{
    static readonly List<string> Log = new();

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: in what order do these run? =====");
        Log.Clear();
        try
        {
            try
            {
                Log.Add("A: before throw");
                throw new InvalidOperationException("x");
            }
            catch (InvalidOperationException)
            {
                Log.Add("B: inner catch");
                throw;
            }
            finally
            {
                Log.Add("C: inner finally");
            }
        }
        catch (Exception) when (Note("D: filter"))
        {
            Log.Add("E: outer catch");
        }
        finally
        {
            Log.Add("F: outer finally");
        }
        Console.WriteLine($"  {string.Join(" -> ", Log)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: which trace survives? =====");
        Console.WriteLine("  throw;");
        Console.WriteLine($"    {FramesOf(A_Rethrow)}");
        Console.WriteLine("  throw ex;");
        Console.WriteLine($"    {FramesOf(B_ThrowEx)}");
        Console.WriteLine("  throw new X(..., ex);");
        Console.WriteLine($"    {FramesOf(C_Wrap)}");
        Console.WriteLine("  ExceptionDispatchInfo.Capture(ex).Throw();");
        Console.WriteLine($"    {FramesOf(D_Dispatch)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: exception or return value? =====");
        var inputs = Enumerable.Range(1, 50_000)
            .Select(i => i % 10 == 0 ? i.ToString(CultureInfo.InvariantCulture) : $"x{i}")
            .ToArray();

        var thrown = Measure(() =>
        {
            var sum = 0L;
            foreach (var s in inputs)
            {
                try { sum += Parse(s); } catch (FormatException) { }
            }
            return sum;
        });
        var tried = Measure(() =>
        {
            var sum = 0L;
            foreach (var s in inputs)
                if (int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n))
                    sum += n;
            return sum;
        });
        Console.WriteLine($"  50,000 inputs, 90% invalid");
        Console.WriteLine($"    throwing : {thrown.ms:N1} ms");
        Console.WriteLine($"    TryParse : {tried.ms:N2} ms");
        Console.WriteLine($"    ratio    : {thrown.ms / tried.ms:N0}x");
        Console.WriteLine($"    same sum : {thrown.result == tried.result}");

        var rareInputs = Enumerable.Range(1, 50_000)
            .Select(i => i % 10_000 == 0 ? $"x{i}" : i.ToString(CultureInfo.InvariantCulture))
            .ToArray();
        var rareThrown = Measure(() =>
        {
            var sum = 0L;
            foreach (var s in rareInputs)
            {
                try { sum += Parse(s); } catch (FormatException) { }
            }
            return sum;
        });
        var rareTried = Measure(() =>
        {
            var sum = 0L;
            foreach (var s in rareInputs)
                if (int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n))
                    sum += n;
            return sum;
        });
        Console.WriteLine($"  the same 50,000 with 0.01% invalid");
        Console.WriteLine($"    throwing : {rareThrown.ms:N2} ms");
        Console.WriteLine($"    TryParse : {rareTried.ms:N2} ms");
        Console.WriteLine($"    ratio    : {rareThrown.ms / rareTried.ms:N2}x");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: design an exception =====");
        try
        {
            new Settlement().Post("BATCH-9", -50m);
        }
        catch (SettlementException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"    BatchId    = {ex.BatchId}");
            Console.WriteLine($"    Amount     = {ex.Amount}");
            Console.WriteLine($"    Retryable  = {ex.Retryable}");
            Console.WriteLine($"    inner      = {ex.InnerException?.GetType().Name ?? "(none)"}");
        }

        Console.WriteLine();
        Console.WriteLine("  the same failure with a bare exception, for comparison:");
        try
        {
            new Settlement().PostBadly("BATCH-9", -50m);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine("    an operator has the message and nothing else — no batch id");
            Console.WriteLine("    to look up, no amount, and no way to decide about a retry");
            Console.WriteLine("    except by parsing English out of the message string.");
        }
    }

    static bool Note(string s) { Log.Add(s); return true; }

    static int Parse(string s) =>
        int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)
            ? n
            : throw new FormatException($"'{s}' is not a number");

    static void Bottom() => throw new InvalidOperationException("bottom");
    static void Middle() => Bottom();

    static void A_Rethrow()
    {
        try { Middle(); } catch (InvalidOperationException) { throw; }
    }

#pragma warning disable CA2200
    static void B_ThrowEx()
    {
        try { Middle(); } catch (InvalidOperationException ex) { throw ex; }
    }
#pragma warning restore CA2200

    static void C_Wrap()
    {
        try { Middle(); }
        catch (InvalidOperationException ex) { throw new ApplicationException("wrapped", ex); }
    }

    static void D_Dispatch()
    {
        System.Runtime.ExceptionServices.ExceptionDispatchInfo? captured = null;
        try { Middle(); }
        catch (InvalidOperationException ex)
        {
            captured = System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(ex);
        }
        captured!.Throw();
    }

    static string FramesOf(Action a)
    {
        try { a(); }
        catch (Exception ex)
        {
            var names = (ex.StackTrace ?? "")
                .Split('\n')
                .Select(l => l.Trim())
                .Where(l => l.StartsWith("at Program.", StringComparison.Ordinal))
                .Select(l => l.Split('(')[0].Replace("at Program.", "", StringComparison.Ordinal))
                .ToList();
            var inner = ex.InnerException is { } i ? $" (inner: {i.GetType().Name})" : "";
            return $"{ex.GetType().Name} via {string.Join(" <- ", names)}{inner}";
        }
        return "(did not throw)";
    }

    static (long result, double ms) Measure(Func<long> f)
    {
        f();
        var sw = Stopwatch.StartNew();
        var r = f();
        sw.Stop();
        return (r, sw.Elapsed.TotalMilliseconds);
    }
}

public sealed class SettlementException : Exception
{
    public SettlementException(string batchId, decimal amount, bool retryable, string reason,
                               Exception? inner = null)
        : base($"Settlement of batch {batchId} failed: {reason}.", inner)
    {
        BatchId = batchId;
        Amount = amount;
        Retryable = retryable;
    }

    public string BatchId { get; }
    public decimal Amount { get; }
    public bool Retryable { get; }
}

public sealed class Settlement
{
    public void Post(string batchId, decimal amount)
    {
        if (amount <= 0m)
            throw new SettlementException(batchId, amount, retryable: false,
                "amount must be positive",
                new ArgumentOutOfRangeException(nameof(amount), amount, "not positive"));
    }

    public void PostBadly(string batchId, decimal amount)
    {
        if (amount <= 0m) throw new Exception("Settlement failed");
    }
}
