// 01-the-hierarchy.cs — which members exist on which interface, and which
// concrete types implement what. Read off the metadata rather than a diagram.
// .NET 10.0.400. Run: dotnet run 01-the-hierarchy.cs

#:property NoWarn=IL2070;IL2075;IL2090

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;

class Program
{
    static readonly Type[] Interfaces =
    {
        typeof(IEnumerable<>), typeof(IReadOnlyCollection<>), typeof(IReadOnlyList<>),
        typeof(ICollection<>), typeof(IList<>)
    };

    static void Main()
    {
        Console.WriteLine("--- members DECLARED on each interface (not inherited) ---");
        foreach (var t in Interfaces)
        {
            var members = t.GetMembers()
                .Where(m => m.DeclaringType == t)
                .Select(m => m.Name)
                .Where(n => !n.StartsWith("get_") && !n.StartsWith("set_"))
                .OrderBy(n => n);
            Console.WriteLine($"  {t.Name,-26} {string.Join(", ", members)}");
        }

        Console.WriteLine();
        Console.WriteLine("--- what each interface inherits from ---");
        foreach (var t in Interfaces)
        {
            var bases = t.GetInterfaces()
                .Where(i => i.IsGenericType)
                .Select(i => i.Name)
                .OrderBy(n => n);
            Console.WriteLine($"  {t.Name,-26} {(bases.Any() ? string.Join(", ", bases) : "(nothing generic)")}");
        }

        Console.WriteLine();
        Console.WriteLine("--- which concrete types implement which ---");
        var concrete = new (string Name, object Value)[]
        {
            ("int[]", new int[3]),
            ("List<int>", new List<int>()),
            ("HashSet<int>", new HashSet<int>()),
            ("Queue<int>", new Queue<int>()),
            ("ReadOnlyCollection<int>", new ReadOnlyCollection<int>(new List<int>())),
            ("Dictionary<int,int>", new Dictionary<int, int>()),
            ("IEnumerable from LINQ", Enumerable.Range(0, 3).Where(x => x > 0))
        };

        Console.WriteLine($"  {"type",-24} {"IEnum",6} {"IROColl",8} {"IROList",8} {"IColl",6} {"IList",6}");
        foreach (var (name, value) in concrete)
        {
            string Mark(Type open)
            {
                var t = value.GetType();
                bool ok = t.GetInterfaces().Any(i => i.IsGenericType &&
                    i.GetGenericTypeDefinition() == open);
                return ok ? "yes" : "-";
            }
            Console.WriteLine($"  {name,-24} {Mark(typeof(IEnumerable<>)),6} " +
                              $"{Mark(typeof(IReadOnlyCollection<>)),8} {Mark(typeof(IReadOnlyList<>)),8} " +
                              $"{Mark(typeof(ICollection<>)),6} {Mark(typeof(IList<>)),6}");
        }

        Console.WriteLine();
        Console.WriteLine("--- the one that surprises people ---");
        IReadOnlyList<int> readOnly = new List<int> { 1, 2, 3 };
        Console.WriteLine($"  IReadOnlyList<int> holding a List<int>");
        Console.WriteLine($"    is it IList<int>?     {readOnly is IList<int>}");
        Console.WriteLine($"    is it ICollection<int>? {readOnly is ICollection<int>}");
        if (readOnly is IList<int> writable)
        {
            writable.Add(99);
            Console.WriteLine($"    added through the cast: now {readOnly.Count} items");
        }
        Console.WriteLine("  'ReadOnly' in the name describes the INTERFACE, not the object.");

        Console.WriteLine();
        Console.WriteLine("--- and ReadOnlyCollection implements IList<T> too ---");
        IReadOnlyList<int> wrapped = new ReadOnlyCollection<int>(new List<int> { 1, 2, 3 });
        Console.WriteLine($"  is it IList<int>? {wrapped is IList<int>}   (the type test PASSES)");
        try
        {
            ((IList<int>)wrapped).Add(99);
        }
        catch (NotSupportedException)
        {
            Console.WriteLine("  ...and calling Add throws NotSupportedException.");
        }
        Console.WriteLine("  So a type test cannot tell you whether a collection is writable.");
    }
}
