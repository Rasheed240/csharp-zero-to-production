// 06-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 06-exercises.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;

class Config
{
    private readonly Dictionary<string, string?> _values;
    public Config(Dictionary<string, string?> values) => _values = values;

    private int _reads;

    /// <summary>A property whose value can change between reads — a cache, a
    /// request context, a lazily-refreshed token. Very common shape.</summary>
    public string? Token
    {
        get
        {
            _reads++;
            return _reads <= 1 ? "abc123" : null;   // expires after the first read
        }
    }

    public string? Get(string key) => _values.TryGetValue(key, out var v) ? v : null;

    // Exercise 3: without the attribute the caller cannot use the out value.
    public bool TryGetNaive(string key, out string? value)
        => _values.TryGetValue(key, out value) && value is not null;

    public bool TryGet(string key, [NotNullWhen(true)] out string? value)
    {
        value = _values.TryGetValue(key, out var v) ? v : null;
        return value is not null;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which lines warn? =====");
        string? a = Maybe();
        // (1) a.Length            -> CS8602
        // (2) string b = a;       -> CS8600
        // (3) after 'if (a is null) return;' -> no warning
        Console.WriteLine("  (1) a.Length                       -> CS8602");
        Console.WriteLine("  (2) string b = a;                  -> CS8600");
        Console.WriteLine("  (3) same lines after a null guard  -> no warning");
        if (a is null)
        {
            Console.WriteLine("  (a was null this run; the guard returned)");
        }
        else
        {
            Console.WriteLine($"  after the guard, a.Length = {a.Length} with no warning");
        }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: the property that changes =====");
        var config = new Config(new Dictionary<string, string?>
        {
            ["endpoint"] = "https://gateway.ledger.internal",
            ["proxy"] = null
        });

        Console.WriteLine("  the tempting version:");
        try
        {
            if (config.Token is not null)
            {
                // No warning. Two reads, two getter calls, second one null.
                Console.WriteLine($"    token length {config.Token.Length}");
            }
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("    NullReferenceException — no warning was issued");
        }

        Console.WriteLine("  the correct version:");
        var fresh = new Config(new Dictionary<string, string?>());
        var token = fresh.Token;
        if (token is not null)
            Console.WriteLine($"    token length {token.Length} (read once into a local)");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: annotate a TryGet =====");
        Console.WriteLine("  without [NotNullWhen(true)]:");
        if (config.TryGetNaive("endpoint", out var naive))
            Console.WriteLine($"    got a value of length {naive!.Length}   <- needed a '!'");
        Console.WriteLine("  with [NotNullWhen(true)]:");
        if (config.TryGet("endpoint", out var annotated))
            Console.WriteLine($"    got a value of length {annotated.Length}   <- no '!' needed");
        Console.WriteLine($"  missing key      : {config.TryGet("nope", out _)}");
        Console.WriteLine($"  key with a null  : {config.TryGet("proxy", out _)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: migrating a class =====");
        // Assigning null to a non-nullable property is CS8625, quoted here and
        // suppressed so the file builds clean. The legacy class invites it.
#pragma warning disable CS8625
        var before = new LegacyCustomer { Id = "CUST-1", Email = null };
#pragma warning restore CS8625
        Console.WriteLine($"  legacy  : Id={before.Id} Email={before.Email ?? "(null)"} " +
                          $"Nickname={before.Nickname ?? "(null)"}");

        var after = new MigratedCustomer
        {
            Id = "CUST-1",
            Email = "ada@example.com"
        };
        Console.WriteLine($"  migrated: Id={after.Id} Email={after.Email} " +
                          $"Nickname={after.Nickname ?? "(none)"}");
        Console.WriteLine($"  Nickname is string?, so this compiles : {after.Nickname is null}");
        Console.WriteLine("  Omitting Id or Email is CS9035, an ERROR:");
        Console.WriteLine("    'Required member MigratedCustomer.Id must be set in the");
        Console.WriteLine("    object initializer or attribute constructor.'");

        Console.WriteLine();
        Console.WriteLine("  counting the difference:");
        Console.WriteLine("    legacy   : 3 properties, 0 say anything about null");
        Console.WriteLine("    migrated : 3 properties, 2 required non-null, 1 explicitly optional");
        Console.WriteLine("    call sites that must null-check Nickname : all of them");
        Console.WriteLine("    call sites that must null-check Id       : none");
    }

    static string? Maybe() => Environment.TickCount > 0 ? "value" : null;
}

#pragma warning disable CS8618
class LegacyCustomer
{
    public string Id { get; set; }
    public string Email { get; set; }
    public string Nickname { get; set; }
}
#pragma warning restore CS8618

class MigratedCustomer
{
    public required string Id { get; init; }
    public required string Email { get; init; }
    public string? Nickname { get; init; }
}
