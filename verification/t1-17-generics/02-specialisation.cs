// 02-specialisation.cs — the runtime creates one copy of a generic type's code
// per VALUE type argument, and shares a single copy across all REFERENCE type
// arguments. A static field makes that observable.
// .NET 10.0.400. Run: dotnet run 02-specialisation.cs

using System;
using System.Collections.Generic;

// Each closed generic type gets its own copy of every static field.
class Counter<T>
{
    public static int Instances;
    public Counter() => Instances++;
    public static string Describe() => $"{typeof(Counter<T>).Name} for {typeof(T).Name}";
}

// A generic method whose body is identical for every T.
static class Box
{
    public static string Describe<T>(T value) =>
        $"{typeof(T).Name,-10} value={value}  isValueType={typeof(T).IsValueType}";
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- each closed type has its own statics ---");
        _ = new Counter<int>();
        _ = new Counter<int>();
        _ = new Counter<string>();
        _ = new Counter<double>();
        _ = new Counter<double>();
        _ = new Counter<double>();

        Console.WriteLine($"  Counter<int>.Instances    : {Counter<int>.Instances}");
        Console.WriteLine($"  Counter<string>.Instances : {Counter<string>.Instances}");
        Console.WriteLine($"  Counter<double>.Instances : {Counter<double>.Instances}");
        Console.WriteLine($"  Counter<object>.Instances : {Counter<object>.Instances}");
        Console.WriteLine("  Counter<int> and Counter<string> are DIFFERENT types, so they");
        Console.WriteLine("  do not share the static field. This is the clearest evidence");
        Console.WriteLine("  that a closed generic type is a real, distinct type.");

        Console.WriteLine();
        Console.WriteLine("--- are they the same Type object? ---");
        Console.WriteLine($"  typeof(Counter<int>)  == typeof(Counter<string>) : " +
                          $"{typeof(Counter<int>) == typeof(Counter<string>)}");
        Console.WriteLine($"  typeof(List<string>)  == typeof(List<object>)    : " +
                          $"{typeof(List<string>) == typeof(List<object>)}");
        Console.WriteLine($"  open definition of List<int>                     : " +
                          $"{typeof(List<int>).GetGenericTypeDefinition().Name}");

        Console.WriteLine();
        Console.WriteLine("--- one method body, many instantiations ---");
        Console.WriteLine("  " + Box.Describe(42));
        Console.WriteLine("  " + Box.Describe(4.5));
        Console.WriteLine("  " + Box.Describe("text"));
        Console.WriteLine("  " + Box.Describe(new int[3]));
        Console.WriteLine("  The type argument was inferred from the value in every case.");

        Console.WriteLine();
        Console.WriteLine("--- default(T) differs by kind ---");
        Console.WriteLine($"  default(int)     : {Describe(default(int))}");
        Console.WriteLine($"  default(double)  : {Describe(default(double))}");
        Console.WriteLine($"  default(bool)    : {Describe(default(bool))}");
        Console.WriteLine($"  default(string)  : {Describe(default(string))}");
        Console.WriteLine($"  default(DateTime): {Describe(default(DateTime))}");

        Console.WriteLine();
        Console.WriteLine("--- how the runtime shares code ---");
        Console.WriteLine("  Reference type arguments share ONE native code body, because every");
        Console.WriteLine("  reference is the same size and shape. Each value type argument gets");
        Console.WriteLine("  its OWN body, because int, double and DateTime have different sizes");
        Console.WriteLine("  and layouts. That specialisation is why List<int> stores ints");
        Console.WriteLine("  directly with no boxing, and it is the whole performance argument");
        Console.WriteLine("  for generics over object.");
    }

    static string Describe<T>(T value) =>
        value is null ? "null" : $"{value}";
}
