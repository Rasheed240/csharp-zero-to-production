// 04-production.cs — constraints doing real work: a repository that can build
// and identify its entities, and a generic aggregator over any number type.
// .NET 10.0.400. Run: dotnet run 04-production.cs

using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;

public interface IEntity<TId> where TId : notnull
{
    TId Id { get; }
}

public interface IValidatable
{
    IReadOnlyList<string> Validate();
}

public sealed class Customer : IEntity<string>, IValidatable
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public int Age { get; init; }

    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(Id)) errors.Add("Id is required");
        if (string.IsNullOrWhiteSpace(Name)) errors.Add("Name is required");
        if (Age is < 0 or > 130) errors.Add($"Age {Age} is out of range");
        return errors;
    }

    public override string ToString() => $"{Id}:{Name}({Age})";
}

// TEntity must be an entity, must be validatable, and must be constructible —
// three constraints, each unlocking one line of the body.
public sealed class Repository<TEntity, TId>
    where TEntity : class, IEntity<TId>, IValidatable, new()
    where TId : notnull
{
    private readonly Dictionary<TId, TEntity> _byId = new();

    public IReadOnlyCollection<TEntity> All => _byId.Values;

    public IReadOnlyList<string> Save(TEntity entity)
    {
        var errors = entity.Validate();              // IValidatable
        if (errors.Count == 0) _byId[entity.Id] = entity;   // IEntity<TId>, notnull
        return errors;
    }

    public TEntity? Find(TId id) => _byId.GetValueOrDefault(id);

    // new() lets the repository produce a blank instance for callers that
    // want a template to fill in.
    public TEntity Blank() => new TEntity();
}

// A statistics helper over any numeric type, via static abstract members.
public static class Stats
{
    public static T Sum<T>(IEnumerable<T> values) where T : INumber<T>
    {
        T total = T.Zero;
        foreach (var v in values) total += v;
        return total;
    }

    public static T Mean<T>(IReadOnlyCollection<T> values) where T : INumber<T> =>
        values.Count == 0 ? T.Zero : Sum(values) / T.CreateChecked(values.Count);

    public static T Max<T>(IEnumerable<T> values) where T : INumber<T>, IMinMaxValue<T>
    {
        T best = T.MinValue;
        foreach (var v in values) if (v > best) best = v;
        return best;
    }
}

class Program
{
    static void Main()
    {
        var repo = new Repository<Customer, string>();

        Console.WriteLine("--- constrained repository ---");
        foreach (var c in new[]
        {
            new Customer { Id = "C-1", Name = "Ada", Age = 36 },
            new Customer { Id = "C-2", Name = "", Age = 200 },
            new Customer { Id = "C-3", Name = "Grace", Age = 45 }
        })
        {
            var errors = repo.Save(c);
            Console.WriteLine(errors.Count == 0
                ? $"  saved   {c}"
                : $"  refused {c}: {string.Join("; ", errors)}");
        }

        Console.WriteLine($"  stored : {string.Join(", ", repo.All)}");
        Console.WriteLine($"  Find(\"C-1\") : {repo.Find("C-1")}");
        Console.WriteLine($"  Find(\"C-9\") : {repo.Find("C-9")?.ToString() ?? "null"}");
        Console.WriteLine($"  Blank()     : '{repo.Blank()}'");

        Console.WriteLine();
        Console.WriteLine("--- one statistics helper, four numeric types ---");
        Console.WriteLine($"  Sum(int)      : {Stats.Sum(new[] { 1, 2, 3, 4 })}");
        Console.WriteLine($"  Sum(double)   : {Stats.Sum(new[] { 1.5, 2.25 })}");
        Console.WriteLine($"  Sum(decimal)  : {Stats.Sum(new[] { 10.00m, 5.50m })}");
        Console.WriteLine($"  Sum(long)     : {Stats.Sum(new[] { 5_000_000_000L, 1L })}");
        Console.WriteLine($"  Mean(int)     : {Stats.Mean(new[] { 2, 4, 6, 9 })}   (integer division)");
        Console.WriteLine($"  Mean(double)  : {Stats.Mean(new[] { 2.0, 4.0, 6.0, 9.0 })}");
        Console.WriteLine($"  Max(int)      : {Stats.Max(new[] { 3, 17, 8 })}");
        Console.WriteLine($"  Max(byte)     : {Stats.Max(new byte[] { 3, 17, 8 })}");

        Console.WriteLine();
        Console.WriteLine("  Before C# 11 this needed one overload per numeric type. The");
        Console.WriteLine("  operators come from the INumber<T> constraint, and the JIT still");
        Console.WriteLine("  specialises the method for each value type.");
    }
}
