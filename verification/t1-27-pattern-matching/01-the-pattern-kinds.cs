// 01-the-pattern-kinds.cs — every kind of pattern C# 14 has, each shown matching
// and not matching, so the boundaries are visible rather than described.
// .NET 10.0.400. Run: dotnet run 01-the-pattern-kinds.cs

using System;
using System.Collections.Generic;
using System.Linq;

abstract record Shape;
record Circle(double Radius) : Shape;
record Rectangle(double Width, double Height) : Shape;
record Triangle(double A, double B, double C) : Shape;

record Address(string Country, string City);
record Customer(string Name, Address Address, int YearsActive);

class Program
{
    static void Main()
    {
        Console.WriteLine("--- constant pattern: matches a literal ---");
        foreach (object v in new object[] { 0, 1, "one", null! })
            Console.WriteLine($"  {Show(v),-6} is 1        : {v is 1}");

        Console.WriteLine();
        Console.WriteLine("--- null and 'not null' ---");
        foreach (object? v in new object?[] { null, "x", 0 })
            Console.WriteLine($"  {Show(v),-6} is null: {v is null,-5} is not null: {v is not null}");

        Console.WriteLine();
        Console.WriteLine("--- type pattern: matches a type AND binds a variable ---");
        foreach (object v in new object[] { 42, "text", 3.5, new Circle(1) })
        {
            if (v is int n) Console.WriteLine($"  int    -> n = {n}, n*2 = {n * 2}");
            else if (v is string s) Console.WriteLine($"  string -> length {s.Length}");
            else Console.WriteLine($"  other  -> {v.GetType().Name}");
        }
        object? nothing = null;
        Console.WriteLine($"  null is object : {nothing is object}");
        Console.WriteLine("  A type pattern NEVER matches null, even 'is object'.");

        Console.WriteLine();
        Console.WriteLine("--- relational pattern: <, <=, >, >= against a constant ---");
        foreach (var t in new[] { -5, 0, 15, 40 })
            Console.WriteLine($"  {t,3}C -> {Describe(t)}");

        Console.WriteLine();
        Console.WriteLine("--- logical patterns: and, or, not ---");
        foreach (var c in new[] { 'a', 'Z', '7', '!' })
            Console.WriteLine($"  '{c}' -> {Classify(c)}");

        Console.WriteLine();
        Console.WriteLine("--- property pattern: match on members ---");
        var uk = new Customer("Ada", new Address("GB", "London"), 6);
        var us = new Customer("Grace", new Address("US", "Arlington"), 1);
        foreach (var c in new[] { uk, us })
        {
            var isUk = c is { Address.Country: "GB" };
            var isLoyalUk = c is { Address.Country: "GB", YearsActive: >= 5 };
            Console.WriteLine($"  {c.Name,-6} UK          : {isUk}");
            Console.WriteLine($"  {c.Name,-6} UK + loyal  : {isLoyalUk}");
        }
        Console.WriteLine("  'Address.Country' is an extended property pattern (C# 10+).");
        Console.WriteLine("  Before that you nested: { Address: { Country: <literal> } }.");

        Console.WriteLine();
        Console.WriteLine("--- positional pattern: needs Deconstruct, which records generate ---");
        foreach (Shape s in new Shape[] { new Circle(2), new Rectangle(3, 3), new Rectangle(4, 2) })
            Console.WriteLine($"  {s,-24} -> {Name(s)}");

        Console.WriteLine();
        Console.WriteLine("--- var pattern: always matches, binds the value ---");
        Console.WriteLine($"  {Bucket(7)}");
        Console.WriteLine($"  {Bucket(700)}");
        Console.WriteLine("  'var x' is how you name a value mid-pattern so a 'when' can use it.");

        Console.WriteLine();
        Console.WriteLine("--- discard pattern: matches anything, binds nothing ---");
        Console.WriteLine($"  (1, 2) matches (_, _) : {(1, 2) is (_, _)}");

        Console.WriteLine();
        Console.WriteLine("--- list patterns (C# 11+) ---");
        int[][] samples = { new[] { 1 }, new[] { 1, 2 }, new[] { 1, 2, 3, 4, 5 }, Array.Empty<int>() };
        foreach (var arr in samples)
            Console.WriteLine($"  [{string.Join(",", arr),-9}] -> {DescribeList(arr)}");

        Console.WriteLine();
        Console.WriteLine("--- slice pattern binds the middle ---");
        foreach (var arr in samples.Where(a => a.Length >= 2))
        {
            if (arr is [var first, .. var middle, var last])
                Console.WriteLine($"  first={first} middle=[{string.Join(",", middle)}] last={last}");
        }

        Console.WriteLine();
        Console.WriteLine("--- patterns compose: all of the above nest inside each other ---");
        Shape big = new Rectangle(200, 100);
        Console.WriteLine($"  wide rectangle over 100 : " +
                          $"{big is Rectangle { Width: > 100, Height: > 0 } r2 && r2.Width > r2.Height}");
    }

    static string Show(object? v) => v is null ? "null" : v.ToString()!;

    static string Describe(int celsius) => celsius switch
    {
        < 0 => "freezing",
        >= 0 and < 10 => "cold",
        >= 10 and < 25 => "mild",
        _ => "hot"
    };

    static string Classify(char c) => c switch
    {
        >= 'a' and <= 'z' or >= 'A' and <= 'Z' => "letter",
        >= '0' and <= '9' => "digit",
        not (>= ' ' and <= '~') => "non-printable",
        _ => "punctuation"
    };

    static string Name(Shape s) => s switch
    {
        Circle(0) => "a point",
        Circle(var r) => $"circle r={r}",
        Rectangle(var w, var h) when w == h => $"square {w}",
        Rectangle(var w, var h) => $"rectangle {w}x{h}",
        Triangle => "triangle",
        _ => "unknown"
    };

    static string Bucket(int n) => n switch
    {
        var v when v < 10 => $"{v} is small",
        var v => $"{v} is large"
    };

    static string DescribeList(int[] a) => a switch
    {
        [] => "empty",
        [var only] => $"one element: {only}",
        [1, ..] => "starts with 1",
        [.., var last] => $"ends with {last}"
    };
}
