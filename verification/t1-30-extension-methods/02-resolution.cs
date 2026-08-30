// 02-resolution.cs — the rules that decide which method a call actually reaches.
// These are where extension methods stop being obvious, and where the
// maintenance problems come from.
// .NET 10.0.400. Run: dotnet run 02-resolution.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Linq;
using Alpha;                 // both namespaces define Describe(this Widget)
// using Beta;               // uncommenting this makes the call ambiguous: CS0121

namespace Domain
{
    public class Widget
    {
        public string Name { get; init; } = "";
        public string Describe() => $"[instance] {Name}";
    }

    public class Gadget
    {
        public string Name { get; init; } = "";
    }
}

namespace Alpha
{
    using Domain;

    public static class WidgetExtensions
    {
        public static string Describe(this Widget w) => $"[Alpha extension] {w.Name}";
        public static string Tag(this Widget w) => $"alpha:{w.Name}";
        public static string Tag(this Gadget g) => $"alpha:{g.Name}";
    }
}

namespace Beta
{
    using Domain;

    public static class WidgetExtensions
    {
        public static string Describe(this Widget w) => $"[Beta extension] {w.Name}";
    }
}

class Program
{
    static void Main()
    {
        var widget = new Domain.Widget { Name = "W-1" };
        var gadget = new Domain.Gadget { Name = "G-1" };

        Console.WriteLine("--- 1. an instance method ALWAYS wins ---");
        Console.WriteLine($"  widget.Describe() : {widget.Describe()}");
        Console.WriteLine("  Widget has an instance Describe(), so the Alpha extension is");
        Console.WriteLine("  never even considered. Extensions are searched only when no");
        Console.WriteLine("  applicable instance method exists.");
        Console.WriteLine($"  the extension, called explicitly : " +
                          $"{Alpha.WidgetExtensions.Describe(widget)}");

        Console.WriteLine();
        Console.WriteLine("--- and it wins even when it is a WORSE match ---");
        var box = new Box();
        Console.WriteLine($"  box.Store(42)     : {box.Store(42)}");
        Console.WriteLine("  Box.Store(object) is an instance method; Store(this Box, int)");
        Console.WriteLine("  is an extension that matches int exactly. The instance method");
        Console.WriteLine("  still wins — the two are not compared at all.");

        Console.WriteLine();
        Console.WriteLine("--- 2. extensions are only visible via a using directive ---");
        Console.WriteLine($"  gadget.Tag() : {gadget.Tag()}");
        Console.WriteLine("  'using Alpha;' at the top of this file is what makes Tag()");
        Console.WriteLine("  callable. Delete it and this is CS1061, 'Gadget does not");
        Console.WriteLine("  contain a definition for Tag'. The type says nothing about");
        Console.WriteLine("  which extensions exist; the FILE does.");

        Console.WriteLine();
        Console.WriteLine("--- 3. two namespaces, same signature, both imported = ambiguous ---");
        Console.WriteLine("  Adding 'using Beta;' makes widget-typed calls to Describe()");
        Console.WriteLine("  ambiguous where no instance method exists:");
        Console.WriteLine("    error CS0121: The call is ambiguous between the following");
        Console.WriteLine("    methods or properties: 'Alpha.WidgetExtensions.Describe(Widget)'");
        Console.WriteLine("    and 'Beta.WidgetExtensions.Describe(Widget)'");
        Console.WriteLine("  (see 04-compile-errors.cs.txt)");

        Console.WriteLine();
        Console.WriteLine("--- 4. the STATIC type decides, not the runtime type ---");
        Domain.Widget asWidget = new Special { Name = "S-1" };
        Special asSpecial = (Special)asWidget;
        Console.WriteLine($"  declared Widget  : {asWidget.Label()}");
        Console.WriteLine($"  declared Special : {asSpecial.Label()}");
        Console.WriteLine("  Same object, two answers. Extension resolution happens at");
        Console.WriteLine("  COMPILE time from the declared type — there is no virtual");
        Console.WriteLine("  dispatch, because there is no instance method to override.");

        Console.WriteLine();
        Console.WriteLine("--- 5. extending an interface reaches every implementation ---");
        IEnumerable<int> asSequence = new List<int> { 1, 2, 3 };
        int[] asArray = { 1, 2, 3 };
        Console.WriteLine($"  List<int>  via IEnumerable<int> : {asSequence.SecondOrDefault()}");
        Console.WriteLine($"  int[]      via IEnumerable<int> : {asArray.SecondOrDefault()}");
        Console.WriteLine("  This is why LINQ is extension methods: one implementation");
        Console.WriteLine("  covering every type that implements the interface, including");
        Console.WriteLine("  types written after LINQ shipped.");

        Console.WriteLine();
        Console.WriteLine("--- 6. a more specific extension wins over a less specific one ---");
        Console.WriteLine($"  int[]        .Kind() : {asArray.Kind()}");
        Console.WriteLine($"  List<int>    .Kind() : {new List<int>().Kind()}");
        Console.WriteLine($"  HashSet<int> .Kind() : {new HashSet<int>().Kind()}");
        Console.WriteLine("  Overload resolution runs normally once the candidate set is");
        Console.WriteLine("  built, so List<T> beats IEnumerable<T> for a List.");

        Console.WriteLine();
        Console.WriteLine("--- 7. it cannot access private members, so it cannot be a real method ---");
        var counter = new Counter();
        counter.Bump(); counter.Bump();
        Console.WriteLine($"  counter.Count      : {counter.Count}");
        Console.WriteLine($"  counter.Doubled()  : {counter.Doubled()}");
        Console.WriteLine("  Doubled() is an extension reading the public Count. If Count");
        Console.WriteLine("  were made private tomorrow, the extension stops compiling —");
        Console.WriteLine("  which is a real coupling that a method on the type would not");
        Console.WriteLine("  have had.");
    }
}

class Box
{
    public string Store(object value) => $"[instance, object] {value}";
}

class Special : Domain.Widget { }

class Counter
{
    public int Count { get; private set; }
    public void Bump() => Count++;
}

static class MoreExtensions
{
    public static string Store(this Box box, int value) => $"[extension, int] {value}";
    public static string Label(this Domain.Widget w) => $"[Widget] {w.Name}";
    public static string Label(this Special s) => $"[Special] {s.Name}";
    public static int SecondOrDefault(this IEnumerable<int> source) => source.Skip(1).FirstOrDefault();
    public static string Kind<T>(this IEnumerable<T> source) => "IEnumerable";
    public static string Kind<T>(this List<T> source) => "List";
    public static int Doubled(this Counter c) => c.Count * 2;
}
