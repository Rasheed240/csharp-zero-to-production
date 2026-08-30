// 01-what-each-unlocks.cs — every constraint, and the exact capability each one
// grants inside the method body.
// .NET 10.0.400. Run: dotnet run 01-what-each-unlocks.cs

using System;
using System.Collections.Generic;
using System.Numerics;
using System.Runtime.InteropServices;

interface IEntity { string Id { get; } }
sealed class Customer : IEntity { public string Id => "C-1"; public override string ToString() => "Customer"; }
sealed class Widget { public override string ToString() => "Widget"; }

static class Demos
{
    // No constraint: T can do only what object can.
    public static string Unconstrained<T>(T value) => value?.ToString() ?? "null";

    // class: T is a reference type. Enables null comparison and null literal.
    public static string RequiresClass<T>(T? value) where T : class =>
        value is null ? "was null" : value.ToString()!;

    // struct: T is a non-nullable value type. Enables T? meaning Nullable<T>.
    public static string RequiresStruct<T>(T? value) where T : struct =>
        value.HasValue ? $"has {value.Value}" : "no value";

    // notnull: T is not a nullable type. Required by Dictionary's TKey.
    public static Dictionary<T, int> RequiresNotNull<T>() where T : notnull => new();

    // new(): T has a public parameterless constructor. Enables new T().
    public static T RequiresNew<T>() where T : new() => new T();

    // an interface constraint: T has that interface's members.
    public static string RequiresInterface<T>(T value) where T : IEntity => value.Id;

    // a base class constraint: T has that class's members.
    public static string RequiresBase<T>(T value) where T : Exception => value.Message;

    // unmanaged: T contains no references, so it can be used with sizeof and Span.
    public static int SizeOf<T>() where T : unmanaged => Marshal.SizeOf<T>();

    // Multiple constraints, in the required order: class/struct, base, interfaces, new().
    public static T Build<T>(string _) where T : class, IEntity, new() => new T();

    // static abstract members: a requirement on the TYPE, not the instance.
    public static T Sum<T>(params T[] values) where T : INumber<T>
    {
        T total = T.Zero;
        foreach (var v in values) total += v;
        return total;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- what each constraint grants ---");
        Console.WriteLine($"  Unconstrained(42)          : {Demos.Unconstrained(42)}");
        Console.WriteLine($"  RequiresClass<string>(null): {Demos.RequiresClass<string>(null)}");
        Console.WriteLine($"  RequiresStruct<int>(null)  : {Demos.RequiresStruct<int>(null)}");
        Console.WriteLine($"  RequiresStruct<int>(7)     : {Demos.RequiresStruct<int>(7)}");
        Console.WriteLine($"  RequiresNew<Widget>()      : {Demos.RequiresNew<Widget>()}");
        Console.WriteLine($"  RequiresInterface(Customer): {Demos.RequiresInterface(new Customer())}");
        Console.WriteLine($"  RequiresBase(exception)    : " +
                          $"{Demos.RequiresBase(new InvalidOperationException("boom"))}");
        Console.WriteLine($"  SizeOf<int>()              : {Demos.SizeOf<int>()} bytes");
        Console.WriteLine($"  SizeOf<Guid>()             : {Demos.SizeOf<Guid>()} bytes");
        Console.WriteLine($"  Build<Customer>()          : {Demos.Build<Customer>("x")}");

        Console.WriteLine();
        Console.WriteLine("--- static abstract members via INumber<T> ---");
        Console.WriteLine($"  Sum(1, 2, 3)               : {Demos.Sum(1, 2, 3)}");
        Console.WriteLine($"  Sum(1.5, 2.25)             : {Demos.Sum(1.5, 2.25)}");
        Console.WriteLine($"  Sum(10.00m, 5.50m)         : {Demos.Sum(10.00m, 5.50m)}");

        Console.WriteLine();
        Console.WriteLine("--- what T? means depends on the constraint ---");
        Console.WriteLine("  where T : class   ->  T? is a nullable REFERENCE (a warning-level idea)");
        Console.WriteLine("  where T : struct  ->  T? is Nullable<T> (a real, different type)");
        Console.WriteLine($"  typeof(int?)   : {typeof(int?).Name}");
        Console.WriteLine("  typeof(string?) does not even compile — CS8639 — because there is");
        Console.WriteLine("  no such runtime type. Nullable reference types are annotations.");
    }
}
