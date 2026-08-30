// 05-production.cs — a generic result type and a generic cache, written the
// way they appear in a real service.
// .NET 10.0.400. Run: dotnet run 05-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

// A result that carries either a value or an error, without exceptions.
// T is covariant: it only ever comes out.
public interface IResult<out T>
{
    bool Ok { get; }
    T Value { get; }
    string? Error { get; }
}

public sealed class Result<T> : IResult<T>
{
    private readonly T _value;
    public bool Ok { get; }
    public string? Error { get; }

    private Result(bool ok, T value, string? error) => (Ok, _value, Error) = (ok, value, error);

    public T Value => Ok ? _value
        : throw new InvalidOperationException($"Result is an error: {Error}");

    public static Result<T> Success(T value) => new(true, value, null);
    public static Result<T> Failure(string error) => new(false, default!, error);

    // Map keeps the error and transforms the value. Note the second type
    // parameter is on the METHOD, so callers do not restate T.
    public Result<TOut> Map<TOut>(Func<T, TOut> f) =>
        Ok ? Result<TOut>.Success(f(_value)) : Result<TOut>.Failure(Error!);

    public override string ToString() => Ok ? $"Ok({_value})" : $"Error({Error})";
}

// A cache that works for any key and value, with the key constrained only to
// be non-null. Constraints get their own module; this is the minimum.
public sealed class Cache<TKey, TValue> where TKey : notnull
{
    private readonly Dictionary<TKey, TValue> _entries;
    private readonly Func<TKey, TValue> _load;
    public int Loads { get; private set; }
    public int Hits { get; private set; }

    public Cache(Func<TKey, TValue> load, IEqualityComparer<TKey>? comparer = null)
    {
        _load = load;
        _entries = new Dictionary<TKey, TValue>(comparer);
    }

    public TValue Get(TKey key)
    {
        if (_entries.TryGetValue(key, out var hit)) { Hits++; return hit; }
        Loads++;
        var value = _load(key);
        _entries[key] = value;
        return value;
    }

    public int Count => _entries.Count;
}

public readonly record struct Order(string Id, decimal Amount, string Currency);

class Program
{
    static Result<Order> ParseOrder(string line)
    {
        var parts = line.Split(',');
        if (parts.Length != 3) return Result<Order>.Failure($"expected 3 fields, got {parts.Length}");
        if (!decimal.TryParse(parts[1], out var amount))
            return Result<Order>.Failure($"'{parts[1]}' is not a number");
        return Result<Order>.Success(new Order(parts[0], amount, parts[2]));
    }

    static void Main()
    {
        Console.WriteLine("--- a generic result type ---");
        foreach (var line in new[] { "O-1,29.97,GBP", "O-2,oops,GBP", "O-3,10.00" })
        {
            var result = ParseOrder(line);
            Console.WriteLine($"  {line,-18} -> {result}");
        }

        Console.WriteLine();
        Console.WriteLine("--- Map changes the value type and keeps the error ---");
        foreach (var line in new[] { "O-1,29.97,GBP", "O-2,oops,GBP" })
        {
            Result<string> summary = ParseOrder(line).Map(o => $"{o.Id}: {o.Amount:0.00} {o.Currency}");
            Console.WriteLine($"  {line,-18} -> {summary}");
        }

        Console.WriteLine();
        Console.WriteLine("--- covariance works for REFERENCE types only ---");
        Result<string> textResult = Result<string>.Success("O-1");
        IResult<object> loose = textResult;          // string is a class: allowed
        Console.WriteLine($"  IResult<string> as IResult<object> : Ok={loose.Ok}, Value={loose.Value}");

        Console.WriteLine("  IResult<Order> as IResult<object>  : does not compile (CS0266),");
        Console.WriteLine("  because Order is a struct. A variance conversion is a reference");
        Console.WriteLine("  conversion — it reinterprets a pointer, it does not box. Value");
        Console.WriteLine("  type arguments are therefore always invariant.");

        Console.WriteLine();
        Console.WriteLine("--- one cache, two very different instantiations ---");
        var rates = new Cache<string, decimal>(
            code => code switch { "GBP" => 1.00m, "USD" => 1.27m, _ => 0m },
            StringComparer.OrdinalIgnoreCase);

        foreach (var c in new[] { "GBP", "gbp", "USD", "GBP" })
            Console.WriteLine($"  rates.Get(\"{c}\") = {rates.Get(c)}");
        Console.WriteLine($"  loads {rates.Loads}, hits {rates.Hits}, entries {rates.Count}");

        var squares = new Cache<int, long>(n => (long)n * n);
        foreach (var n in new[] { 9, 9, 12 })
            Console.WriteLine($"  squares.Get({n}) = {squares.Get(n)}");
        Console.WriteLine($"  loads {squares.Loads}, hits {squares.Hits}, entries {squares.Count}");

        Console.WriteLine();
        Console.WriteLine("  Cache<int, long> stores its keys and values with no boxing,");
        Console.WriteLine("  because the runtime specialised it for those value types.");
    }
}
