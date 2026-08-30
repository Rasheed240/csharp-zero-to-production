// Enumerating a delegate type's members via reflection touches the
// Delegate.CreateDelegate overloads, which carry trimming annotations. The
// warnings are about publishing trimmed, not about this demonstration.
#:property NoWarn=IL2026;IL2111

// 01-what-a-delegate-is.cs — a delegate value is an object holding a method
// and, for instance methods, the object to call it on.
// .NET 10.0.400. Run: dotnet run 01-what-a-delegate-is.cs

using System;
using System.Linq;

// A delegate TYPE declaration: "a method taking int and returning int".
delegate int Transform(int value);

class Multiplier
{
    private readonly int _factor;
    public Multiplier(int factor) => _factor = factor;
    public int Apply(int value) => value * _factor;
}

class Program
{
    static int Double(int value) => value * 2;

    static void Main()
    {
        Console.WriteLine("--- three ways to make the same shape of value ---");
        Transform fromStaticMethod = Double;
        Transform fromInstanceMethod = new Multiplier(3).Apply;
        Transform fromLambda = v => v * 4;

        Console.WriteLine($"  fromStaticMethod(10)   : {fromStaticMethod(10)}");
        Console.WriteLine($"  fromInstanceMethod(10) : {fromInstanceMethod(10)}");
        Console.WriteLine($"  fromLambda(10)         : {fromLambda(10)}");

        Console.WriteLine();
        Console.WriteLine("--- what the value actually holds ---");
        foreach (var (name, d) in new (string, Transform)[]
                 { ("static method", fromStaticMethod),
                   ("instance method", fromInstanceMethod),
                   ("lambda", fromLambda) })
        {
            Console.WriteLine($"  {name,-16} Method={d.Method.Name,-12} " +
                              $"Target={(d.Target?.GetType().Name ?? "null")}");
        }
        Console.WriteLine("  Target is the object the method runs on. A static method has none.");

        Console.WriteLine();
        Console.WriteLine("--- the delegate type itself ---");
        Console.WriteLine($"  typeof(Transform).BaseType      : {typeof(Transform).BaseType?.Name}");
        Console.WriteLine($"  its BaseType                    : {typeof(Transform).BaseType?.BaseType?.Name}");
        Console.WriteLine($"  declared methods                : " +
            string.Join(", ", typeof(Transform)
                .GetMethods(System.Reflection.BindingFlags.Public |
                            System.Reflection.BindingFlags.Instance |
                            System.Reflection.BindingFlags.DeclaredOnly)
                .Select(m => m.Name).OrderBy(n => n)));

        Console.WriteLine();
        Console.WriteLine("--- the built-in generic delegate types ---");
        Func<int, int> func = Double;
        Action<int> action = v => Console.WriteLine($"    action saw {v}");
        Predicate<int> predicate = v => v > 5;
        Func<int> noArgs = () => 42;
        Action noArgsNoReturn = () => Console.WriteLine("    action with nothing");

        Console.WriteLine($"  Func<int,int>(10)  : {func(10)}");
        action(7);
        Console.WriteLine($"  Predicate<int>(10) : {predicate(10)}");
        Console.WriteLine($"  Func<int>()        : {noArgs()}");
        noArgsNoReturn();

        Console.WriteLine();
        Console.WriteLine("  Func<...,TResult> returns a value; Action<...> returns void;");
        Console.WriteLine("  Predicate<T> is Func<T,bool> with a name. Func takes up to 16");
        Console.WriteLine("  parameters, with the RETURN type always last in the list.");

        Console.WriteLine();
        Console.WriteLine("--- delegates are values: pass them, store them, return them ---");
        Transform chosen = DateTime.UtcNow.Ticks % 2 == 0 ? fromStaticMethod : fromLambda;
        Console.WriteLine($"  chosen at run time     : {chosen.Method.Name}");
        Console.WriteLine($"  applied to 5           : {chosen(5)}");
        Console.WriteLine($"  a method taking one    : {ApplyTwice(fromStaticMethod, 5)}");
        Console.WriteLine($"  a method returning one : {MakeAdder(100)(5)}");
    }

    static int ApplyTwice(Transform t, int value) => t(t(value));

    static Func<int, int> MakeAdder(int amount) => value => value + amount;
}
