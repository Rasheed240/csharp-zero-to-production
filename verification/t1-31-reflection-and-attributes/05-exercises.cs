// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 05-exercises.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075;IL2072;IL3050
#:property PublishAot=false

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;

[AttributeUsage(AttributeTargets.Property)]
public sealed class AuditedAttribute : Attribute
{
    public string? Reason { get; init; }
}

public class Payment
{
    [Audited(Reason = "regulatory")] public string Reference { get; set; } = "P-1";
    [Audited] public long AmountMinor { get; set; } = 5_000;
    public string Note { get; set; } = "internal";
    private string Secret { get; set; } = "hidden";
    public string Describe() => $"{Reference}/{AmountMinor}";
    private string Hidden() => "not for you";
}

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: what does each call return? =====");
        var t = typeof(Payment);
        Console.WriteLine($"  GetProperties()                       : {t.GetProperties().Length}");
        Console.WriteLine($"  GetProperties(Public|Instance)        : " +
                          $"{t.GetProperties(BindingFlags.Public | BindingFlags.Instance).Length}");
        Console.WriteLine($"  GetProperties(NonPublic|Instance)     : " +
                          $"{t.GetProperties(BindingFlags.NonPublic | BindingFlags.Instance).Length}");
        Console.WriteLine($"  GetProperties(NonPublic)              : " +
                          $"{t.GetProperties(BindingFlags.NonPublic).Length}");
        Console.WriteLine($"  GetMethod(\"Hidden\")                   : " +
                          $"{t.GetMethod("Hidden")?.Name ?? "(null)"}");
        Console.WriteLine($"  GetMethod(\"Hidden\", NonPublic|Instance): " +
                          $"{t.GetMethod("Hidden", BindingFlags.NonPublic | BindingFlags.Instance)?.Name ?? "(null)"}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: read the attributes =====");
        foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var audited = p.GetCustomAttribute<AuditedAttribute>();
            Console.WriteLine($"  {p.Name,-12} audited={audited is not null,-5} " +
                              $"reason={audited?.Reason ?? "(none)"}");
        }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: make it fast =====");
        var payment = new Payment();
        var prop = t.GetProperty(nameof(Payment.AmountMinor))!;

        var lookupEveryTime = Time(() =>
        {
            var p = typeof(Payment).GetProperty("AmountMinor")!;
            _sink += (long)p.GetValue(payment)!;
        }, 200_000);

        var cachedInfo = Time(() => { _sink += (long)prop.GetValue(payment)!; }, 200_000);

        var getter = prop.GetGetMethod()!.CreateDelegate<Func<Payment, long>>();
        var viaDelegate = Time(() => { _sink += getter(payment); });

        var param = Expression.Parameter(typeof(Payment), "p");
        var compiled = Expression.Lambda<Func<Payment, long>>(
            Expression.Property(param, prop), param).Compile();
        var viaExpression = Time(() => { _sink += compiled(payment); });

        var direct = Time(() => { _sink += payment.AmountMinor; });

        var d = Ns(direct);
        Console.WriteLine($"  direct                     : {d,8:N1} ns/op   1.0x");
        Console.WriteLine($"  GetProperty + GetValue     : {Ns(lookupEveryTime, 200_000),8:N1} ns/op   " +
                          $"{Ns(lookupEveryTime, 200_000) / d,5:N0}x");
        Console.WriteLine($"  cached PropertyInfo        : {Ns(cachedInfo, 200_000),8:N1} ns/op   " +
                          $"{Ns(cachedInfo, 200_000) / d,5:N0}x");
        Console.WriteLine($"  CreateDelegate             : {Ns(viaDelegate),8:N1} ns/op   " +
                          $"{Ns(viaDelegate) / d,5:N1}x");
        Console.WriteLine($"  compiled expression        : {Ns(viaExpression),8:N1} ns/op   " +
                          $"{Ns(viaExpression) / d,5:N1}x");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: a plugin loader =====");
        var handlers = DiscoverHandlers();
        Console.WriteLine($"  handlers found : {handlers.Count}");
        foreach (var (name, handler) in handlers.OrderBy(h => h.Key, StringComparer.Ordinal))
            Console.WriteLine($"    {name,-14} -> {handler("P-9")}");

        Console.WriteLine();
        Console.WriteLine("  the same discovery, timed:");
        var discovery = Time(() => { _sink += DiscoverHandlers().Count; }, 2_000);
        Console.WriteLine($"    per discovery : {Ns(discovery, 2_000):N0} ns");
        Console.WriteLine($"    done once at startup : {Ns(discovery, 2_000) / 1_000_000:N3} ms");
        Console.WriteLine($"    types scanned : {typeof(Program).Assembly.GetTypes().Length}");
        Console.WriteLine("  Microseconds — but this assembly has a handful of types. A");
        Console.WriteLine("  real service assembly with a few thousand is milliseconds, and");
        Console.WriteLine("  scanning every LOADED assembly is tens to hundreds. Either way");
        Console.WriteLine("  it belongs at startup, once, not per request.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static Dictionary<string, Func<string, string>> DiscoverHandlers()
    {
        var result = new Dictionary<string, Func<string, string>>(StringComparer.Ordinal);
        foreach (var type in typeof(Program).Assembly.GetTypes())
        {
            if (type.IsAbstract || type.IsInterface) continue;
            if (!typeof(IEventHandler).IsAssignableFrom(type)) continue;

            var instance = (IEventHandler)Activator.CreateInstance(type)!;
            var handle = type.GetMethod(nameof(IEventHandler.Handle))!;
            result[type.Name] = handle.CreateDelegate<Func<string, string>>(instance);
        }
        return result;
    }

    static double Time(Action a, int iterations = 1_000_000)
    {
        for (var i = 0; i < Math.Min(iterations, 1_000); i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < iterations; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds;
    }

    static double Ns(double ms, int iterations = 1_000_000) => ms * 1_000_000 / iterations;
}

public interface IEventHandler
{
    string Handle(string paymentRef);
}

public sealed class AuthorisedHandler : IEventHandler
{
    public string Handle(string paymentRef) => $"authorised {paymentRef}";
}

public sealed class DeclinedHandler : IEventHandler
{
    public string Handle(string paymentRef) => $"declined {paymentRef}";
}

public sealed class SettledHandler : IEventHandler
{
    public string Handle(string paymentRef) => $"settled {paymentRef}";
}
