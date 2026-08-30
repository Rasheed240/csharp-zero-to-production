// 01-abstract-vs-virtual.cs — what abstract adds over virtual, and what the
// compiler enforces in each case.
// .NET 10.0.400. Run: dotnet run 01-abstract-vs-virtual.cs

#:property NoWarn=IL2075

using System;
using System.Linq;
using System.Reflection;

abstract class Exporter
{
    // ABSTRACT: no body. Every concrete subclass MUST supply one.
    public abstract string Extension { get; }
    public abstract string Serialise(string[] rows);

    // VIRTUAL: has a body. Subclasses MAY replace it.
    public virtual string Describe() => $"exporter producing .{Extension} files";

    // Neither: subclasses get this and cannot change it.
    public string Export(string[] rows) => $"{Serialise(rows)}  [.{Extension}]";
}

sealed class CsvExporter : Exporter
{
    public override string Extension => "csv";
    public override string Serialise(string[] rows) => string.Join(",", rows);
}

sealed class TsvExporter : Exporter
{
    public override string Extension => "tsv";
    public override string Serialise(string[] rows) => string.Join("\t", rows);
    public override string Describe() => "tab-separated exporter";
}

// An abstract class may derive from another and stay abstract.
abstract class BufferedExporter : Exporter
{
    public override string Describe() => $"buffered {base.Describe()}";
    // Serialise and Extension are still unimplemented. That is legal here.
}

sealed class JsonExporter : BufferedExporter
{
    public override string Extension => "json";
    public override string Serialise(string[] rows) =>
        "[" + string.Join(",", rows.Select(r => $"\"{r}\"")) + "]";
}

class Program
{
    static void Main()
    {
        string[] rows = { "id", "name", "amount" };

        Exporter[] all = { new CsvExporter(), new TsvExporter(), new JsonExporter() };
        foreach (var e in all)
        {
            Console.WriteLine($"{e.GetType().Name,-14} {e.Describe()}");
            Console.WriteLine($"               {e.Export(rows).Replace("\t", "<TAB>")}");
        }

        Console.WriteLine();
        Console.WriteLine("What the compiler records:");
        foreach (var t in new[] { typeof(Exporter), typeof(BufferedExporter), typeof(CsvExporter) })
            Console.WriteLine($"  {t.Name,-18} IsAbstract={t.IsAbstract,-6} IsSealed={t.IsSealed}");

        Console.WriteLine();
        Console.WriteLine("Members of Exporter, and which kind each is:");
        foreach (var m in typeof(Exporter)
                 .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                 .OrderBy(m => m.Name))
        {
            string kind = m.IsAbstract ? "abstract" : m.IsVirtual ? "virtual" : "non-virtual";
            Console.WriteLine($"  {m.Name,-16} {kind}");
        }

        Console.WriteLine();
        Console.WriteLine("An abstract class cannot be instantiated:");
        try
        {
            var made = Activator.CreateInstance(typeof(Exporter));
            Console.WriteLine($"  created {made}");
        }
        catch (MissingMethodException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
        }
        Console.WriteLine("  (in source, 'new Exporter()' is compile error CS0144)");
    }
}
