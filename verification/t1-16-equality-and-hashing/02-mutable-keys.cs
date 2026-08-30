// 02-mutable-keys.cs — a dictionary decides which bucket an entry lives in
// when you insert it. Change the key afterwards and the entry is still there,
// in a bucket nothing will look in again.
// .NET 10.0.400. Run: dotnet run 02-mutable-keys.cs

using System;
using System.Collections.Generic;
using System.Linq;

sealed class MutableKey
{
    public string Region { get; set; }
    public MutableKey(string region) => Region = region;

    public override bool Equals(object? obj) => obj is MutableKey o && o.Region == Region;
    public override int GetHashCode() => Region.GetHashCode();
    public override string ToString() => $"Key({Region})";
}

sealed record ImmutableKey(string Region);

class Program
{
    static void Main()
    {
        Console.WriteLine("--- a class key, mutated after insertion ---");
        var key = new MutableKey("eu-west-2");
        var map = new Dictionary<MutableKey, string> { [key] = "london" };

        Console.WriteLine($"  before: ContainsKey(key)        : {map.ContainsKey(key)}");
        Console.WriteLine($"  before: Count                   : {map.Count}");

        key.Region = "us-east-1";          // the object in the dictionary changed

        Console.WriteLine($"  after : ContainsKey(key)        : {map.ContainsKey(key)}");
        Console.WriteLine($"  after : ContainsKey(new equal)  : " +
                          $"{map.ContainsKey(new MutableKey("us-east-1"))}");
        Console.WriteLine($"  after : ContainsKey(old value)  : " +
                          $"{map.ContainsKey(new MutableKey("eu-west-2"))}");
        Console.WriteLine($"  after : Count                   : {map.Count}");
        Console.WriteLine($"  after : enumerating finds it    : " +
                          $"{map.Keys.First()} -> {map.Values.First()}");

        Console.WriteLine();
        Console.WriteLine("  The entry is present, enumerable, and unreachable by lookup.");
        Console.WriteLine("  Remove() cannot find it either:");
        Console.WriteLine($"    map.Remove(key)               : {map.Remove(key)}");
        Console.WriteLine($"    Count after Remove            : {map.Count}");

        Console.WriteLine();
        Console.WriteLine("  Inserting the 'same' key again adds a SECOND entry:");
        map[new MutableKey("us-east-1")] = "virginia";
        Console.WriteLine($"    Count                         : {map.Count}");
        foreach (var kv in map) Console.WriteLine($"    {kv.Key} -> {kv.Value}");

        Console.WriteLine();
        Console.WriteLine("--- the same shape with an immutable key ---");
        var safe = new Dictionary<ImmutableKey, string>
        {
            [new ImmutableKey("eu-west-2")] = "london"
        };
        Console.WriteLine($"  ContainsKey(equal key)          : " +
                          $"{safe.ContainsKey(new ImmutableKey("eu-west-2"))}");
        Console.WriteLine("  There is no setter, so the situation above cannot arise.");
    }
}
