// 02-beforefieldinit.cs — writing an explicit static constructor changes WHEN
// static initialisation runs, even when the constructor body is empty.
// .NET 10.0.400. Run: dotnet run 02-beforefieldinit.cs -c Release

using System;
using System.Reflection;

static class Trace
{
    public static int Init(string who) { Console.WriteLine($"    [init] {who}"); return 1; }
}

// NO explicit static constructor. The compiler marks the type
// 'beforefieldinit': the runtime may initialise it at any point before the
// first static field is READ, including much earlier than you expect.
class Lazyish
{
    public static readonly int Value = Trace.Init("Lazyish.Value");
    public static void DoesNotTouchFields() => Console.WriteLine("    Lazyish.DoesNotTouchFields()");
}

// WITH an explicit static constructor, even an empty one. The type is NOT
// beforefieldinit, and the runtime must initialise it exactly at the first
// access to ANY static member — including a method that reads no fields.
class Precise
{
    public static readonly int Value = Trace.Init("Precise.Value");
    static Precise() { }
    public static void DoesNotTouchFields() => Console.WriteLine("    Precise.DoesNotTouchFields()");
}

class Program
{
    static void Main()
    {
        Console.WriteLine("Type attributes as recorded in metadata:");
        foreach (var t in new[] { typeof(Lazyish), typeof(Precise) })
            Console.WriteLine($"  {t.Name,-10} BeforeFieldInit=" +
                              $"{(t.Attributes & TypeAttributes.BeforeFieldInit) != 0}");

        Console.WriteLine();
        Console.WriteLine("Calling a static method that reads no static fields:");
        Console.WriteLine("  Lazyish:");
        Lazyish.DoesNotTouchFields();
        Console.WriteLine("  Precise:");
        Precise.DoesNotTouchFields();

        Console.WriteLine();
        Console.WriteLine("Now reading a static field from each:");
        Console.WriteLine($"  Lazyish.Value = {Lazyish.Value}");
        Console.WriteLine($"  Precise.Value = {Precise.Value}");

        Console.WriteLine();
        Console.WriteLine("The difference: with beforefieldinit the runtime is FREE to");
        Console.WriteLine("initialise whenever it likes before the first field read, so the");
        Console.WriteLine("ordering above is a permitted behaviour rather than a guarantee.");
        Console.WriteLine("With an explicit static constructor the timing is specified.");
    }
}
