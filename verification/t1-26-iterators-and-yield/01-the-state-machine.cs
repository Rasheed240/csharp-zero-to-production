// 01-the-state-machine.cs — what the compiler builds for a method containing
// `yield return`, read out of the assembly's own metadata rather than asserted.
// .NET 10.0.400. Run: dotnet run 01-the-state-machine.cs
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

class Program
{
    static IEnumerable<int> Counting()
    {
        Console.WriteLine("    [body] start");
        yield return 1;
        Console.WriteLine("    [body] after first yield");
        yield return 2;
        Console.WriteLine("    [body] after second yield");
    }

    static void Main()
    {
        Console.WriteLine("--- calling the method runs NONE of its body ---");
        var seq = Counting();
        Console.WriteLine($"  returned object type : {seq.GetType().Name}");
        Console.WriteLine("  (nothing printed from the body above this line)");

        Console.WriteLine();
        Console.WriteLine("--- stepping it by hand ---");
        var e = seq.GetEnumerator();
        Console.WriteLine($"  enumerator type : {e.GetType().Name}");
        Console.WriteLine($"  same object?    : {ReferenceEquals(seq, e)}");
        while (e.MoveNext())
            Console.WriteLine($"  MoveNext -> true, Current = {e.Current}");
        Console.WriteLine("  MoveNext -> false");

        Console.WriteLine();
        Console.WriteLine("--- what the compiler generated ---");
        var generated = typeof(Program).Assembly.GetTypes()
            .Where(t => t.Name.Contains("d__"))
            .ToArray();
        foreach (var t in generated)
        {
            Console.WriteLine($"  type : {t.Name}");
            Console.WriteLine($"    nested in : {t.DeclaringType?.Name}");
            Console.WriteLine($"    is class  : {t.IsClass}");
            Console.WriteLine($"    interfaces: {string.Join(", ", t.GetInterfaces().Select(i => i.Name).OrderBy(n => n))}");
            var fields = t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            Console.WriteLine($"    fields    : {string.Join(", ", fields.Select(f => f.Name))}");
        }
        Console.WriteLine("  ONE class implements both IEnumerable<T> and IEnumerator<T>.");
        Console.WriteLine("  <>1__state is the resume point. <>2__current is what Current returns.");

        Console.WriteLine();
        Console.WriteLine("--- one object serves the first foreach, then clones itself ---");
        var shared = Counting();
        var a = shared.GetEnumerator();
        var b = shared.GetEnumerator();
        Console.WriteLine($"  first GetEnumerator is the object itself : {ReferenceEquals(shared, a)}");
        Console.WriteLine($"  second GetEnumerator is a copy           : {!ReferenceEquals(shared, b)}");
        Console.WriteLine("  So a second foreach starts from the beginning. The iterator is");
        Console.WriteLine("  re-runnable, unlike a hand-written enumerator that keeps state.");

        Console.WriteLine();
        Console.WriteLine("--- the non-generic interfaces are there too ---");
        Console.WriteLine($"  is IEnumerable      : {seq is IEnumerable}");
        Console.WriteLine($"  is IEnumerable<int> : {seq is IEnumerable<int>}");
        Console.WriteLine($"  is IEnumerator<int> : {seq is IEnumerator<int>}");
        Console.WriteLine($"  is IDisposable      : {seq is IDisposable}");
    }
}
