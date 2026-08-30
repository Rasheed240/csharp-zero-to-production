// 03-production.cs — a small attribute-driven validator for Ledger, written the
// way a real one has to be: metadata discovered once per type and cached, and
// per-instance work done through delegates rather than PropertyInfo.
// .NET 10.0.400. Run: dotnet run 03-production.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075;IL2072;IL3050
#:property PublishAot=false

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;

namespace Ledger.Validation;

[AttributeUsage(AttributeTargets.Property, AllowMultiple = false, Inherited = true)]
public sealed class RequiredAttribute : Attribute { }

[AttributeUsage(AttributeTargets.Property, AllowMultiple = false, Inherited = true)]
public sealed class RangeAttribute : Attribute
{
    public RangeAttribute(long min, long max) { Min = min; Max = max; }
    public long Min { get; }
    public long Max { get; }
}

[AttributeUsage(AttributeTargets.Property, AllowMultiple = true, Inherited = true)]
public sealed class AllowedValueAttribute : Attribute
{
    public AllowedValueAttribute(string value) => Value = value;
    public string Value { get; }
}

public class PaymentInstruction
{
    [Required] public string? Reference { get; set; }
    [Required] public string? CustomerId { get; set; }
    [Range(1, 1_000_000_00)] public long AmountMinor { get; set; }
    [AllowedValue("GBP")]
    [AllowedValue("EUR")]
    [AllowedValue("USD")]
    public string? Currency { get; set; }
    public string? Note { get; set; }       // unvalidated
}

/// <summary>
/// Reflection happens ONCE per type. Everything after that is delegate calls.
/// </summary>
public static class Validator
{
    private sealed record Rule(string PropertyName, Func<object, object?> Read, Func<object?, string?> Check);

    private static readonly ConcurrentDictionary<Type, Rule[]> Cache = new();

    public static IReadOnlyList<string> Validate(object instance)
    {
        ArgumentNullException.ThrowIfNull(instance);
        var rules = Cache.GetOrAdd(instance.GetType(), BuildRules);

        var errors = new List<string>();
        foreach (var rule in rules)
        {
            var message = rule.Check(rule.Read(instance));
            if (message is not null) errors.Add($"{rule.PropertyName}: {message}");
        }
        return errors;
    }

    public static int CachedTypeCount => Cache.Count;

    private static Rule[] BuildRules(Type type)
    {
        var rules = new List<Rule>();
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var read = CompileGetter(type, property);

            if (property.GetCustomAttribute<RequiredAttribute>() is not null)
                rules.Add(new Rule(property.Name, read,
                    v => v is null || (v is string s && s.Length == 0) ? "is required" : null));

            if (property.GetCustomAttribute<RangeAttribute>() is { } range)
                rules.Add(new Rule(property.Name, read,
                    v => v is long l && (l < range.Min || l > range.Max)
                        ? $"must be between {range.Min} and {range.Max}"
                        : null));

            var allowed = property.GetCustomAttributes<AllowedValueAttribute>()
                                  .Select(a => a.Value).ToArray();
            if (allowed.Length > 0)
                rules.Add(new Rule(property.Name, read,
                    v => v is string s && !allowed.Contains(s, StringComparer.Ordinal)
                        ? $"must be one of {string.Join(", ", allowed)}"
                        : null));
        }
        return rules.ToArray();
    }

    /// <summary>An expression tree compiled once: object -> object?, no boxing per call
    /// beyond what the signature forces.</summary>
    private static Func<object, object?> CompileGetter(Type type, PropertyInfo property)
    {
        var instance = Expression.Parameter(typeof(object), "instance");
        var body = Expression.Convert(
            Expression.Property(Expression.Convert(instance, type), property),
            typeof(object));
        return Expression.Lambda<Func<object, object?>>(body, instance).Compile();
    }
}

/// <summary>The naive version, for comparison: reflection on every call.</summary>
public static class NaiveValidator
{
    public static IReadOnlyList<string> Validate(object instance)
    {
        var errors = new List<string>();
        foreach (var property in instance.GetType()
                     .GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var value = property.GetValue(instance);

            if (property.GetCustomAttribute<RequiredAttribute>() is not null &&
                (value is null || (value is string s && s.Length == 0)))
                errors.Add($"{property.Name}: is required");

            if (property.GetCustomAttribute<RangeAttribute>() is { } range &&
                value is long l && (l < range.Min || l > range.Max))
                errors.Add($"{property.Name}: must be between {range.Min} and {range.Max}");

            var allowed = property.GetCustomAttributes<AllowedValueAttribute>()
                                  .Select(a => a.Value).ToArray();
            if (allowed.Length > 0 && value is string cs &&
                !allowed.Contains(cs, StringComparer.Ordinal))
                errors.Add($"{property.Name}: must be one of {string.Join(", ", allowed)}");
        }
        return errors;
    }
}

class Program
{
    static void Main()
    {
        var bad = new PaymentInstruction
        {
            Reference = null,
            CustomerId = "CUST-1",
            AmountMinor = 0,
            Currency = "XYZ",
            Note = "anything goes here"
        };
        var good = new PaymentInstruction
        {
            Reference = "P-1",
            CustomerId = "CUST-1",
            AmountMinor = 120_00,
            Currency = "GBP"
        };

        Console.WriteLine("--- validating ---");
        foreach (var error in Validator.Validate(bad)) Console.WriteLine($"  {error}");
        Console.WriteLine($"  a valid instance produces : {Validator.Validate(good).Count} errors");
        Console.WriteLine($"  types cached so far       : {Validator.CachedTypeCount}");
        Console.WriteLine("  Note has no attributes, so no rule was built for it. The");
        Console.WriteLine("  attribute is the schema and the class is the single source.");

        Console.WriteLine();
        Console.WriteLine("--- the two validators agree ---");
        var cachedErrors = Validator.Validate(bad).OrderBy(e => e, StringComparer.Ordinal).ToArray();
        var naiveErrors = NaiveValidator.Validate(bad).OrderBy(e => e, StringComparer.Ordinal).ToArray();
        Console.WriteLine($"  identical : {cachedErrors.SequenceEqual(naiveErrors, StringComparer.Ordinal)}");

        Console.WriteLine();
        Console.WriteLine("--- and cost very different amounts ---");
        var cached = Time(() => { _sink += Validator.Validate(bad).Count; });
        var naive = Time(() => { _sink += NaiveValidator.Validate(bad).Count; });
        Console.WriteLine($"  cached (reflect once, then delegates) : {cached:N0} ns/op");
        Console.WriteLine($"  naive  (reflect every call)           : {naive:N0} ns/op");
        Console.WriteLine($"  ratio                                 : {naive / cached:N1}x");
        Console.WriteLine();
        Console.WriteLine($"  allocation, cached : {AllocOf(() => _sink += Validator.Validate(bad).Count):N0} bytes/call");
        Console.WriteLine($"  allocation, naive  : {AllocOf(() => _sink += NaiveValidator.Validate(bad).Count):N0} bytes/call");

        Console.WriteLine();
        Console.WriteLine("--- what the difference means at request rates ---");
        var saved = naive - cached;
        Console.WriteLine($"  saved per validation : {saved:N0} ns");
        Console.WriteLine($"  at 1,000 req/s       : {saved * 1000 / 1_000_000:N2} ms of CPU per second");
        Console.WriteLine($"  at 20 validations/req: {saved * 20_000 / 1_000_000:N1} ms of CPU per second");
        Console.WriteLine("  The caching is one ConcurrentDictionary and it is the whole");
        Console.WriteLine("  difference between a usable framework and a slow one.");

        Console.WriteLine();
        Console.WriteLine("--- attribute inheritance and multiplicity ---");
        var currency = typeof(PaymentInstruction).GetProperty(nameof(PaymentInstruction.Currency))!;
        Console.WriteLine($"  [AllowedValue] count on Currency : " +
                          $"{currency.GetCustomAttributes<AllowedValueAttribute>().Count()}");
        Console.WriteLine("  AllowMultiple = true is what permits three of them. The default");
        Console.WriteLine("  is false, and a second one is then a compile error (CS0579).");
        var derived = typeof(RecurringInstruction).GetProperty(nameof(PaymentInstruction.Reference))!;
        Console.WriteLine($"  [Required] visible on a derived type's property : " +
                          $"{derived.GetCustomAttribute<RequiredAttribute>() is not null}");
        Console.WriteLine("  Inherited = true on the attribute, plus GetCustomAttribute's own");
        Console.WriteLine("  default of inherit: true. Both have to agree.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    static long _sink;

    static double Time(Action a)
    {
        for (var i = 0; i < 10_000; i++) a();
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 200_000; i++) a();
        sw.Stop();
        return sw.Elapsed.TotalMilliseconds * 1_000_000 / 200_000;
    }

    static long AllocOf(Action a)
    {
        a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        a();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }
}

public sealed class RecurringInstruction : PaymentInstruction
{
    public int EveryDays { get; set; }
}
