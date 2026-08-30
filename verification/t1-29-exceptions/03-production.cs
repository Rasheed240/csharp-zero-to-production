// 03-production.cs — exception design in Ledger's payment gateway client: a
// custom exception carrying the data an operator needs, filters used to decide
// retry policy without catching, and a TryX alternative where failure is normal.
// .NET 10.0.400. Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;

namespace Ledger.Gateway;

/// <summary>
/// Carries what an operator needs to act: which payment, which provider code,
/// and whether retrying could possibly help. The message alone is never enough.
/// </summary>
public sealed class GatewayException : Exception
{
    public GatewayException(string paymentRef, string providerCode, bool isTransient, Exception? inner = null)
        : base($"Gateway rejected payment {paymentRef} with code '{providerCode}'.", inner)
    {
        PaymentRef = paymentRef;
        ProviderCode = providerCode;
        IsTransient = isTransient;
    }

    public string PaymentRef { get; }
    public string ProviderCode { get; }
    public bool IsTransient { get; }
}

public sealed class PaymentGateway
{
    private readonly Queue<string> _scriptedCodes;
    public int Attempts { get; private set; }

    public PaymentGateway(IEnumerable<string> scriptedCodes)
        => _scriptedCodes = new Queue<string>(scriptedCodes);

    public string Authorise(string paymentRef, decimal amount)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(paymentRef);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount);

        Attempts++;
        var code = _scriptedCodes.Count > 0 ? _scriptedCodes.Dequeue() : "approved";
        return code switch
        {
            "approved" => $"AUTH-{paymentRef}",
            "timeout" => throw new GatewayException(paymentRef, code, isTransient: true,
                             new TimeoutException("no response within 5s")),
            "rate_limited" => throw new GatewayException(paymentRef, code, isTransient: true),
            _ => throw new GatewayException(paymentRef, code, isTransient: false)
        };
    }
}

public static class Retry
{
    /// <summary>
    /// The filter decides whether to retry WITHOUT catching non-transient
    /// failures — those propagate with their original stack intact.
    /// </summary>
    public static T WithRetries<T>(Func<T> operation, int maxAttempts, Action<string> log)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return operation();
            }
            catch (GatewayException ex) when (ex.IsTransient && attempt < maxAttempts)
            {
                log($"attempt {attempt} failed with '{ex.ProviderCode}', retrying");
            }
        }
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- a transient failure, retried ---");
        var gateway = new PaymentGateway(new[] { "timeout", "rate_limited", "approved" });
        var log = new List<string>();
        var auth = Retry.WithRetries(() => gateway.Authorise("P-1", 120m), 5, log.Add);
        foreach (var line in log) Console.WriteLine($"  {line}");
        Console.WriteLine($"  result : {auth} after {gateway.Attempts} attempts");

        Console.WriteLine();
        Console.WriteLine("--- a permanent failure is NOT retried ---");
        var declining = new PaymentGateway(new[] { "stolen_card" });
        log.Clear();
        try
        {
            Retry.WithRetries(() => declining.Authorise("P-2", 120m), 5, log.Add);
        }
        catch (GatewayException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
            Console.WriteLine($"    PaymentRef   = {ex.PaymentRef}");
            Console.WriteLine($"    ProviderCode = {ex.ProviderCode}");
            Console.WriteLine($"    IsTransient  = {ex.IsTransient}");
            Console.WriteLine($"    attempts made: {declining.Attempts}");
        }
        Console.WriteLine("  The filter returned false, so this was never caught by the");
        Console.WriteLine("  retry loop at all — no stack was unwound and rebuilt, and the");
        Console.WriteLine("  trace still points at Authorise.");

        Console.WriteLine();
        Console.WriteLine("--- retries exhausted: the LAST exception propagates ---");
        var flaky = new PaymentGateway(new[] { "timeout", "timeout", "timeout", "timeout" });
        log.Clear();
        try
        {
            Retry.WithRetries(() => flaky.Authorise("P-3", 120m), 3, log.Add);
        }
        catch (GatewayException ex)
        {
            Console.WriteLine($"  after {flaky.Attempts} attempts: {ex.ProviderCode}, " +
                              $"inner = {ex.InnerException?.GetType().Name ?? "(none)"}");
        }

        Console.WriteLine();
        Console.WriteLine("--- argument guards fire before any work ---");
        var g = new PaymentGateway(Array.Empty<string>());
        foreach (var (r, a) in new (string, decimal)[] { ("", 10m), ("P-4", 0m), ("P-4", -5m) })
        {
            try { g.Authorise(r, a); }
            catch (ArgumentException ex)
            {
                Console.WriteLine($"  ({(r == "" ? "empty ref" : $"amount {a}")}) -> " +
                                  $"{ex.GetType().Name}, ParamName={ex.ParamName}");
            }
        }
        Console.WriteLine($"  attempts made by the gateway : {g.Attempts}");

        Console.WriteLine();
        Console.WriteLine("--- where exceptions are the WRONG tool ---");
        var refs = Enumerable.Range(1, 20_000)
            .Select(i => i % 3 == 0 ? $"P-{i}" : $"bad-{i}")
            .ToArray();

        var withExceptions = Time(() =>
        {
            var ok = 0;
            foreach (var r in refs)
            {
                try { ok += ParseRef(r); }
                catch (FormatException) { }
            }
            return ok;
        });
        var withTry = Time(() =>
        {
            var ok = 0;
            foreach (var r in refs)
                if (TryParseRef(r, out var n)) ok += n;
            return ok;
        });

        Console.WriteLine($"  20,000 refs, ~2/3 invalid");
        Console.WriteLine($"    exception per invalid : {withExceptions.ms:N1} ms");
        Console.WriteLine($"    TryParse pattern      : {withTry.ms:N1} ms");
        Console.WriteLine($"    ratio                 : {withExceptions.ms / withTry.ms:N0}x");
        Console.WriteLine($"    same answer           : {withExceptions.result == withTry.result}");
        Console.WriteLine("  Validation of untrusted input is not exceptional — it is the");
        Console.WriteLine("  expected case. That is the test for whether to throw.");
    }

    static int ParseRef(string r)
    {
        if (!r.StartsWith("P-", StringComparison.Ordinal))
            throw new FormatException($"'{r}' is not a payment reference");
        return int.Parse(r[2..], CultureInfo.InvariantCulture);
    }

    static bool TryParseRef(string r, out int value)
    {
        value = 0;
        return r.StartsWith("P-", StringComparison.Ordinal)
            && int.TryParse(r[2..], NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
    }

    static (int result, double ms) Time(Func<int> f)
    {
        f();
        var sw = Stopwatch.StartNew();
        var r = f();
        sw.Stop();
        return (r, sw.Elapsed.TotalMilliseconds);
    }
}
