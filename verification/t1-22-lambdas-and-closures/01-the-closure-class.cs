// 01-the-closure-class.cs — a lambda is an ordinary method on a generated
// class. Capturing a variable means that variable MOVES onto an object.
// .NET 10.0.400. Run: dotnet run 01-the-closure-class.cs

#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Linq;
using System.Reflection;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- three lambdas, three different generated shapes ---");

        Func<int, int> capturesNothing = x => x * 2;

        int factor = 3;
        Func<int, int> capturesLocal = x => x * factor;

        var helper = new Helper(4);
        Func<int, int> capturesThis = helper.Multiply;

        foreach (var (name, d) in new (string, Func<int, int>)[]
                 { ("captures nothing", capturesNothing),
                   ("captures a local", capturesLocal),
                   ("instance method", capturesThis) })
        {
            Console.WriteLine($"  {name,-18} Method={d.Method.Name,-22} " +
                              $"Target={d.Target?.GetType().Name ?? "null"}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what the compiler generated in this assembly ---");
        var generated = typeof(Program).Assembly.GetTypes()
            .Where(t => t.Name.Contains("<>"))
            .OrderBy(t => t.Name);
        foreach (var t in generated)
        {
            Console.WriteLine($"  {t.Name}");
            foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.NonPublic |
                                          BindingFlags.Instance | BindingFlags.Static))
                Console.WriteLine($"      field  {f.FieldType.Name,-16} {f.Name}");
            foreach (var m in t.GetMethods(BindingFlags.Public | BindingFlags.NonPublic |
                                           BindingFlags.Instance | BindingFlags.DeclaredOnly))
                Console.WriteLine($"      method {m.ReturnType.Name,-16} {m.Name}");
        }

        Console.WriteLine();
        Console.WriteLine("  The class holding a captured variable is named <>c__DisplayClass...");
        Console.WriteLine("  and has a FIELD for each captured variable. The one for lambdas");
        Console.WriteLine("  that capture nothing is named <>c and its delegate is cached in a");
        Console.WriteLine("  static field, which is why it allocates once and never again.");

        Console.WriteLine();
        Console.WriteLine("--- capture is BY VARIABLE, not by value ---");
        int counter = 0;
        Func<int> read = () => counter;
        Action bump = () => counter++;

        Console.WriteLine($"  read() before        : {read()}");
        counter = 10;
        Console.WriteLine($"  after counter = 10   : {read()}");
        bump();
        Console.WriteLine($"  after bump()         : {read()}  and counter is {counter}");
        Console.WriteLine("  Both lambdas and the method body share ONE variable, which now");
        Console.WriteLine("  lives on the display class rather than on the stack.");
    }
}

sealed class Helper
{
    private readonly int _factor;
    public Helper(int factor) => _factor = factor;
    public int Multiply(int x) => x * _factor;
}
