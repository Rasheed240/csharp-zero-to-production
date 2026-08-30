// 03-attributes.cs — the attributes that describe nullability the annotation
// alone cannot: conditional on a return value, conditional on an argument, and
// promises a method makes about fields. Each is shown with and without.
// .NET 10.0.400. Run: dotnet run 03-attributes.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

class Parser
{
    // WITHOUT the attribute: the caller gets no benefit from checking the bool.
    public static bool TryParseNaive(string? text, out string? result)
    {
        result = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        return result is not null;
    }

    // WITH it: "when this returns true, result is not null".
    public static bool TryParse(string? text, [NotNullWhen(true)] out string? result)
    {
        result = string.IsNullOrWhiteSpace(text) ? null : text.Trim();
        return result is not null;
    }

    // "when this returns false, value is not null" — the shape of IsNullOrEmpty.
    public static bool IsBlank([NotNullWhen(false)] string? value)
        => string.IsNullOrWhiteSpace(value);

    // "the result is null only if the argument was" — the shape of Path.GetDirectoryName.
    [return: NotNullIfNotNull(nameof(input))]
    public static string? Normalise(string? input) => input?.Trim().ToUpperInvariant();

    // "when this returns false, the OUT parameter may be null" — for TryGet shapes
    // that hand back a value type or an unconstrained T.
    public static bool TryFirst<T>(IReadOnlyList<T> items, [MaybeNullWhen(false)] out T first)
    {
        if (items.Count == 0) { first = default!; return false; }
        first = items[0];
        return true;
    }
}

class Connection
{
    private string? _endpoint;

    // "after this returns, _endpoint is not null" — so Send() needs no check.
    [MemberNotNull(nameof(_endpoint))]
    private void EnsureOpen()
    {
        _endpoint ??= "https://gateway.ledger.internal";
    }

    public string Send(string body)
    {
        EnsureOpen();
        // No CS8602 here: the attribute told the compiler _endpoint is set.
        return $"POST {_endpoint.ToLowerInvariant()} ({body.Length} bytes)";
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- [NotNullWhen(true)] on an out parameter ---");
        foreach (var input in new[] { "  INV-1  ", "   ", null })
        {
            if (Parser.TryParse(input, out var parsed))
            {
                // No warning: the attribute proved parsed is not null in this branch.
                Console.WriteLine($"  parsed \"{input ?? "null"}\" -> \"{parsed}\" (length {parsed.Length})");
            }
            else
            {
                Console.WriteLine($"  parsed \"{input ?? "null"}\" -> no value");
            }
        }
        Console.WriteLine("  Without the attribute the same code warns CS8602 on");
        Console.WriteLine("  parsed.Length, because 'out string?' means 'maybe null'");
        Console.WriteLine("  regardless of what the bool says.");

        Console.WriteLine();
        Console.WriteLine("--- [NotNullWhen(false)] on an argument ---");
        string? candidate = Environment.TickCount > 0 ? "value" : null;
        if (!Parser.IsBlank(candidate))
        {
            // No warning: IsBlank returning false proved candidate is not null.
            Console.WriteLine($"  not blank, length {candidate.Length}");
        }
        Console.WriteLine("  This is exactly how string.IsNullOrEmpty is annotated in the");
        Console.WriteLine("  base library, which is why 'if (!string.IsNullOrEmpty(s))'");
        Console.WriteLine("  narrows s and a hand-rolled equivalent usually does not.");

        Console.WriteLine();
        Console.WriteLine("--- [NotNullIfNotNull] ties output nullability to input ---");
        string? given = "  inv-1  ";
        var normalised = Parser.Normalise(given);
        Console.WriteLine($"  Normalise(\"{given}\") -> \"{normalised}\" (length {normalised.Length})");
        Console.WriteLine($"  Normalise(null)          -> {Parser.Normalise(null) ?? "(null)"}");
        Console.WriteLine("  One method, two contracts, no overloads. The compiler picks");
        Console.WriteLine("  the right one from the argument's nullability at each call.");

        Console.WriteLine();
        Console.WriteLine("--- [MaybeNullWhen(false)] for TryGet over an unconstrained T ---");
        var names = new List<string> { "ada", "grace" };
        var empty = new List<string>();
        if (Parser.TryFirst(names, out var firstName))
            Console.WriteLine($"  first of 2 : {firstName.ToUpperInvariant()}");
        if (!Parser.TryFirst(empty, out var none))
            Console.WriteLine($"  first of 0 : no value (out is {none ?? "(null)"})");

        Console.WriteLine();
        Console.WriteLine("--- [MemberNotNull] lets an initialiser satisfy the compiler ---");
        var connection = new Connection();
        Console.WriteLine($"  {connection.Send("{}")}");
        Console.WriteLine("  Without [MemberNotNull], Send() warns CS8602 on _endpoint");
        Console.WriteLine("  even though EnsureOpen() has just assigned it: the compiler");
        Console.WriteLine("  does not look inside the call. The attribute is how you tell");
        Console.WriteLine("  it what the call guarantees.");

        Console.WriteLine();
        Console.WriteLine("--- what the attributes are and are not ---");
        Console.WriteLine("  They are compile-time claims. Nothing verifies that TryParse");
        Console.WriteLine("  actually sets result when it returns true — the attribute is");
        Console.WriteLine("  believed. A wrong attribute is a lie the compiler propagates");
        Console.WriteLine("  to every caller, which is worse than no attribute at all.");
    }
}
