// 01-what-a-record-generates.cs — a record is a class (or struct) with a set of
// members written for you. This prints exactly which ones.
// .NET 10.0.400. Run: dotnet run 01-what-a-record-generates.cs

#:property NoWarn=IL2070;IL2075

using System;
using System.Linq;
using System.Reflection;

public class PlainCustomer
{
    public string Name { get; init; } = "";
    public int Age { get; init; }
}

public record CustomerRecord(string Name, int Age);

public record struct PointRecord(int X, int Y);

public readonly record struct ReadonlyPoint(int X, int Y);

class Program
{
    const BindingFlags Declared =
        BindingFlags.Public | BindingFlags.NonPublic |
        BindingFlags.Instance | BindingFlags.DeclaredOnly;

    static void Main()
    {
        Console.WriteLine("Members the compiler generated for 'record CustomerRecord(string, int)':");
        Dump(typeof(CustomerRecord));

        Console.WriteLine();
        Console.WriteLine("For comparison, the hand-written class:");
        Dump(typeof(PlainCustomer));

        Console.WriteLine();
        Console.WriteLine("Value equality comes for free with a record:");
        var r1 = new CustomerRecord("Ada", 36);
        var r2 = new CustomerRecord("Ada", 36);
        Console.WriteLine($"  r1 == r2                : {r1 == r2}");
        Console.WriteLine($"  r1.Equals(r2)           : {r1.Equals(r2)}");
        Console.WriteLine($"  ReferenceEquals(r1, r2) : {ReferenceEquals(r1, r2)}");
        Console.WriteLine($"  same hash code          : {r1.GetHashCode() == r2.GetHashCode()}");

        var c1 = new PlainCustomer { Name = "Ada", Age = 36 };
        var c2 = new PlainCustomer { Name = "Ada", Age = 36 };
        Console.WriteLine($"  plain class c1.Equals(c2): {c1.Equals(c2)}");

        Console.WriteLine();
        Console.WriteLine("ToString is generated too:");
        Console.WriteLine($"  record : {r1}");
        Console.WriteLine($"  class  : {c1}");

        Console.WriteLine();
        Console.WriteLine("Deconstruct is generated for positional records:");
        var (name, age) = r1;
        Console.WriteLine($"  var (name, age) = r1  ->  {name}, {age}");

        Console.WriteLine();
        Console.WriteLine("record struct and readonly record struct:");
        Console.WriteLine($"  PointRecord is value type   : {typeof(PointRecord).IsValueType}");
        Console.WriteLine($"  ReadonlyPoint is value type : {typeof(ReadonlyPoint).IsValueType}");
        var p1 = new PointRecord(1, 2);
        var p2 = new PointRecord(1, 2);
        Console.WriteLine($"  p1 == p2                    : {p1 == p2}");
        Console.WriteLine($"  p1                          : {p1}");
    }

    static void Dump(Type t)
    {
        foreach (var m in t.GetMembers(Declared)
                          .Where(m => m.MemberType is MemberTypes.Method or MemberTypes.Property
                                      or MemberTypes.Constructor)
                          .Select(m => m.MemberType == MemberTypes.Method
                              ? $"{((MethodInfo)m).ReturnType.Name} {m.Name}"
                              : $"{m.MemberType} {m.Name}")
                          .OrderBy(x => x))
            Console.WriteLine($"  {m}");
    }
}
