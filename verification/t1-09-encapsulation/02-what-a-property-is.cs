// 02-what-a-property-is.cs — a property is a pair of methods plus, usually, a
// hidden field. This prints the members the compiler actually generated.
// .NET 10.0.400. Run: dotnet run 02-what-a-property-is.cs

using System;
using System.Linq;
using System.Reflection;

class Sample
{
    public int PlainField = 0;                       // a field, and nothing else

    public int AutoProperty { get; set; }        // compiler writes field + 2 methods

    public int GetOnly { get; }                  // field + 1 method

    private int _celsius;
    public int Fahrenheit                        // no backing field of its own
    {
        get => (_celsius * 9 / 5) + 32;
        set => _celsius = (value - 32) * 5 / 9;
    }
}

class Program
{
    const BindingFlags All =
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

    static void Main()
    {
        var t = typeof(Sample);

        Console.WriteLine("FIELDS the type really has:");
        foreach (var f in t.GetFields(All).OrderBy(f => f.Name))
        {
            string vis = f.IsPublic ? "public " : "private";
            Console.WriteLine($"  {vis}  {f.FieldType.Name,-6} {f.Name}");
        }

        Console.WriteLine();
        Console.WriteLine("METHODS the type really has (excluding inherited):");
        foreach (var m in t.GetMethods(All)
                           .Where(m => m.DeclaringType == t)
                           .OrderBy(m => m.Name))
        {
            Console.WriteLine($"  {m.ReturnType.Name,-6} {m.Name}(" +
                string.Join(", ", m.GetParameters().Select(p => p.ParameterType.Name)) + ")");
        }

        Console.WriteLine();
        Console.WriteLine("PROPERTIES as the compiler records them:");
        foreach (var p in t.GetProperties(All).OrderBy(p => p.Name))
        {
            string getter = p.GetMethod?.Name ?? "(none)";
            string setter = p.SetMethod?.Name ?? "(none)";
            Console.WriteLine($"  {p.Name,-14} get={getter,-18} set={setter}");
        }

        Console.WriteLine();
        Console.WriteLine("A property is not a storage location:");
        Console.WriteLine($"  PlainField is a field?    {t.GetField("PlainField") != null}");
        Console.WriteLine($"  AutoProperty is a field?  {t.GetField("AutoProperty") != null}");
        Console.WriteLine($"  Fahrenheit has a field?   " +
            $"{t.GetFields(All).Any(f => f.Name.Contains("Fahrenheit"))}");
    }
}
