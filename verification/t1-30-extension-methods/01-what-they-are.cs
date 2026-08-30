// 01-what-they-are.cs — an extension method is a static method with syntactic
// sugar at the call site, and every surprising thing about them follows from
// that. Read out of metadata rather than asserted.
// .NET 10.0.400. Run: dotnet run 01-what-they-are.cs
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;

public static class StringExtensions
{
    /// <summary>The 'this' modifier on the first parameter is the whole feature.</summary>
    public static string OrDefault(this string? value, string fallback)
        => string.IsNullOrWhiteSpace(value) ? fallback : value;

    public static int WordCount(this string value)
        => value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- the two spellings are the same call ---");
        var s = "  ";
        Console.WriteLine($"  s.OrDefault(\"none\")                  : {s.OrDefault("none")}");
        Console.WriteLine($"  StringExtensions.OrDefault(s, \"none\") : {StringExtensions.OrDefault(s, "none")}");
        Console.WriteLine("  Identical. The compiler rewrites the first into the second.");

        Console.WriteLine();
        Console.WriteLine("--- it works on a NULL receiver ---");
        string? nothing = null;
        Console.WriteLine($"  nothing.OrDefault(\"fallback\") : {nothing.OrDefault("fallback")}");
        Console.WriteLine("  No NullReferenceException. There is no instance to dereference:");
        Console.WriteLine("  null is passed as an ordinary argument to a static method.");
        try
        {
            Console.WriteLine(nothing!.WordCount());
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  ...but WordCount() throws, because ITS BODY dereferences the");
            Console.WriteLine("  parameter. The extension is null-safe only if it is written to be.");
        }

        Console.WriteLine();
        Console.WriteLine("--- what the compiler emitted ---");
        var method = typeof(StringExtensions).GetMethod(nameof(StringExtensions.OrDefault))!;
        Console.WriteLine($"  IsStatic                        : {method.IsStatic}");
        Console.WriteLine($"  declaring type is static+sealed : " +
                          $"{typeof(StringExtensions).IsAbstract && typeof(StringExtensions).IsSealed}");
        Console.WriteLine($"  has [Extension] attribute       : " +
                          $"{method.IsDefined(typeof(ExtensionAttribute), false)}");
        Console.WriteLine($"  first parameter                 : " +
                          $"{method.GetParameters()[0].ParameterType.Name} {method.GetParameters()[0].Name}");
        Console.WriteLine("  A static method, in a static class, marked [Extension]. That");
        Console.WriteLine("  attribute is the only thing telling the compiler it may be");
        Console.WriteLine("  called with instance syntax.");

        Console.WriteLine();
        Console.WriteLine("--- it cannot see private state ---");
        var account = new Account("ACC-1", 250m);
        Console.WriteLine($"  account.Describe() : {account.Describe()}");
        Console.WriteLine("  Describe() reads only the PUBLIC surface. An extension has");
        Console.WriteLine("  exactly the access an ordinary caller has — no more.");

        Console.WriteLine();
        Console.WriteLine("--- C# 14 extension members: properties and static members ---");
        Console.WriteLine($"  \"  \".IsBlank        : {"  ".IsBlank}");
        Console.WriteLine($"  \"text\".IsBlank      : {"text".IsBlank}");
        Console.WriteLine($"  new List<int>().IsEmpty : {new List<int>().IsEmpty}");
        Console.WriteLine($"  Money.Zero (static)     : {Money.Zero}");
        Console.WriteLine("  An 'extension(T x) { ... }' block can declare properties and");
        Console.WriteLine("  static members, which the old 'this' syntax never could.");
        Console.WriteLine("  New in C# 14 / .NET 10. On .NET 8 and 9 only extension METHODS");
        Console.WriteLine("  exist, and IsBlank would have to be IsBlank().");

        Console.WriteLine();
        Console.WriteLine("--- the old and new syntaxes coexist ---");
        var words = "the quick brown fox";
        Console.WriteLine($"  words.WordCount()  (old syntax) : {words.WordCount()}");
        Console.WriteLine($"  words.IsBlank      (new syntax) : {words.IsBlank}");
        Console.WriteLine("  Both compile to static methods on a static class. The new form");
        Console.WriteLine("  is a different way to declare them, not a different mechanism.");
    }
}

public sealed class Account
{
    private readonly decimal _balance;      // private: invisible to any extension
    public Account(string id, decimal balance) { Id = id; _balance = balance; }
    public string Id { get; }
    public decimal Balance => _balance;
}

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() => $"{Amount:0.00} {Currency}";
}

public static class NewStyleExtensions
{
    extension(string s)
    {
        public bool IsBlank => string.IsNullOrWhiteSpace(s);
    }

    extension<T>(IEnumerable<T> source)
    {
        public bool IsEmpty => !source.Any();
    }

    extension(Money)
    {
        // A STATIC extension member: Money.Zero, on a type you do not own.
        public static Money Zero => new(0m, "GBP");
    }

    extension(Account account)
    {
        public string Describe() => $"{account.Id} holds {account.Balance:0.00}";
    }
}
