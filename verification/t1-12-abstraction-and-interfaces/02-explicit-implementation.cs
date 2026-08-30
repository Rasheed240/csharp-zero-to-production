// 02-explicit-implementation.cs — implementing an interface member so that it
// is reachable ONLY through the interface, and why that is sometimes the only
// legal option.
// .NET 10.0.400. Run: dotnet run 02-explicit-implementation.cs

using System;
using System.Collections.Generic;
using System.Linq;

interface IJsonWriter { string Write(object value); }
interface IXmlWriter { string Write(object value); }     // same signature, different meaning

// Implementing both implicitly is impossible: one method cannot be both.
// Explicit implementation gives each interface its own member.
sealed class DualWriter : IJsonWriter, IXmlWriter
{
    string IJsonWriter.Write(object value) => $"{{\"value\":\"{value}\"}}";
    string IXmlWriter.Write(object value) => $"<value>{value}</value>";

    // The class's own, ordinary member. Unrelated to either interface.
    public string Write(object value) => $"default:{value}";
}

// Hiding a member that would clutter the public surface.
interface ILifecycle
{
    void Start();
    void Stop();
}

sealed class BackgroundWorker : ILifecycle
{
    private bool _running;

    // Explicit: callers holding a BackgroundWorker cannot call these by accident.
    // Only the host, which holds an ILifecycle, can.
    void ILifecycle.Start() { _running = true; Console.WriteLine("  worker started"); }
    void ILifecycle.Stop() { _running = false; Console.WriteLine("  worker stopped"); }

    public bool IsRunning => _running;
    public int Process(int items) => _running ? items : 0;
}

class Program
{
    static void Main()
    {
        var w = new DualWriter();

        Console.WriteLine("Same object, three different Write methods:");
        Console.WriteLine($"  w.Write(42)                : {w.Write(42)}");
        Console.WriteLine($"  ((IJsonWriter)w).Write(42) : {((IJsonWriter)w).Write(42)}");
        Console.WriteLine($"  ((IXmlWriter)w).Write(42)  : {((IXmlWriter)w).Write(42)}");

        Console.WriteLine();
        Console.WriteLine("Explicit members are not on the class's public surface:");
        var publicNames = typeof(BackgroundWorker)
            .GetMethods(System.Reflection.BindingFlags.Public
                      | System.Reflection.BindingFlags.Instance
                      | System.Reflection.BindingFlags.DeclaredOnly)
            .Select(m => m.Name).OrderBy(n => n);
        Console.WriteLine($"  public methods on BackgroundWorker: {string.Join(", ", publicNames)}");
        Console.WriteLine("  Start and Stop are absent — 'worker.Start()' is a compile error.");

        var bw = new BackgroundWorker();
        Console.WriteLine($"  before: IsRunning={bw.IsRunning}, Process(10)={bw.Process(10)}");

        ILifecycle host = bw;
        host.Start();
        Console.WriteLine($"  after : IsRunning={bw.IsRunning}, Process(10)={bw.Process(10)}");
        host.Stop();

        Console.WriteLine();
        Console.WriteLine("The members do exist, marked private and final in metadata:");
        foreach (var m in typeof(BackgroundWorker)
                 .GetMethods(System.Reflection.BindingFlags.NonPublic
                           | System.Reflection.BindingFlags.Instance
                           | System.Reflection.BindingFlags.DeclaredOnly)
                 .Where(m => m.Name.Contains("ILifecycle"))
                 .OrderBy(m => m.Name))
            Console.WriteLine($"  {m.Name}  IsPrivate={m.IsPrivate}, IsFinal={m.IsFinal}");
    }
}
