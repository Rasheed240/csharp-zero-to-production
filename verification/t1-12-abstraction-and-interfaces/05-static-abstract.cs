// 05-static-abstract.cs — interfaces can require STATIC members, which lets a
// generic method call a constructor-like or operator member on a type
// parameter. C# 11 and later; the basis of the generic-math interfaces.
// .NET 10.0.400. Run: dotnet run 05-static-abstract.cs

using System;
using System.Globalization;
using System.Numerics;

// A contract on the TYPE, not on an instance.
interface IParsable2<TSelf> where TSelf : IParsable2<TSelf>
{
    static abstract TSelf Parse(string text);
    static abstract string Label { get; }
}

readonly record struct Celsius(double Degrees) : IParsable2<Celsius>
{
    public static Celsius Parse(string text) =>
        new(double.Parse(text, CultureInfo.InvariantCulture));
    public static string Label => "°C";
    public override string ToString() => $"{Degrees}{Label}";
}

readonly record struct Money(decimal Amount) : IParsable2<Money>
{
    public static Money Parse(string text) =>
        new(decimal.Parse(text, CultureInfo.InvariantCulture));
    public static string Label => "GBP";
    public override string ToString() => $"{Amount:0.00} {Label}";
}

class Program
{
    // One method that can parse ANY type satisfying the contract, with no
    // instance to call through and no reflection.
    static T[] ParseAll<T>(params string[] inputs) where T : IParsable2<T>
    {
        var result = new T[inputs.Length];
        for (int i = 0; i < inputs.Length; i++) result[i] = T.Parse(inputs[i]);
        return result;
    }

    static string Describe<T>() where T : IParsable2<T> => $"{typeof(T).Name} measured in {T.Label}";

    // Generic math: the same idea in the base class library.
    static T Sum<T>(params T[] values) where T : INumber<T>
    {
        T total = T.Zero;
        foreach (var v in values) total += v;
        return total;
    }

    static T Mean<T>(params T[] values) where T : INumber<T>
        => Sum(values) / T.CreateChecked(values.Length);

    static void Main()
    {
        Console.WriteLine("A generic method calling a static member on its type parameter:");
        foreach (var c in ParseAll<Celsius>("21.5", "-3", "100")) Console.WriteLine($"  {c}");
        foreach (var m in ParseAll<Money>("19.99", "4.50")) Console.WriteLine($"  {m}");

        Console.WriteLine();
        Console.WriteLine($"  {Describe<Celsius>()}");
        Console.WriteLine($"  {Describe<Money>()}");

        Console.WriteLine();
        Console.WriteLine("The same mechanism, in the standard library (INumber<T>):");
        Console.WriteLine($"  Sum(1, 2, 3, 4)            = {Sum(1, 2, 3, 4)}");
        Console.WriteLine($"  Sum(1.5, 2.25)             = {Sum(1.5, 2.25)}");
        Console.WriteLine($"  Sum(10.00m, 5.50m)         = {Sum(10.00m, 5.50m)}");
        Console.WriteLine($"  Mean(2, 4, 6, 9)           = {Mean(2, 4, 6, 9)}   (int division)");
        Console.WriteLine($"  Mean(2.0, 4.0, 6.0, 9.0)   = {Mean(2.0, 4.0, 6.0, 9.0)}");

        Console.WriteLine();
        Console.WriteLine("Before C# 11 this needed one overload per numeric type, or boxing");
        Console.WriteLine("through a non-generic interface. The operator now comes from the");
        Console.WriteLine("constraint, and the JIT specialises the method per value type.");
    }
}
