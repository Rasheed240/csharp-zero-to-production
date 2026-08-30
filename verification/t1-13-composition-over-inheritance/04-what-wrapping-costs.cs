// 04-what-wrapping-costs.cs — composition is not free of consequences. A
// wrapper is a different object from the thing it wraps, and code that asks
// questions about the object gets answers about the wrapper.
// .NET 10.0.400. Run: dotnet run 04-what-wrapping-costs.cs

using System;
using System.Collections.Generic;
using System.Linq;

interface IHandler
{
    string Name { get; }
    string Handle(string request);
}

sealed class OrderHandler : IHandler
{
    public string Name => "orders";
    public string Handle(string r) => $"handled({r})";
}

// A capability only some handlers have.
interface IBatchCapable { string HandleBatch(string[] requests); }

sealed class BatchOrderHandler : IHandler, IBatchCapable
{
    public string Name => "orders";
    public string Handle(string r) => $"handled({r})";
    public string HandleBatch(string[] rs) => $"batch({rs.Length})";
}

sealed class Logging : IHandler
{
    private readonly IHandler _inner;
    public Logging(IHandler inner) => _inner = inner;
    public string Name => _inner.Name;              // forwarded on purpose
    public string Handle(string r) => $"log[{_inner.Handle(r)}]";
}

// The forwarding version: it passes the capability through when the inner one
// has it. Note the amount of code this takes for ONE extra interface.
sealed class LoggingForwarding : IHandler, IBatchCapable
{
    private readonly IHandler _inner;
    public LoggingForwarding(IHandler inner) => _inner = inner;
    public string Name => _inner.Name;
    public string Handle(string r) => $"log[{_inner.Handle(r)}]";

    public string HandleBatch(string[] rs) =>
        _inner is IBatchCapable b
            ? $"log[{b.HandleBatch(rs)}]"
            : throw new NotSupportedException("inner handler is not batch capable");
}

class Program
{
    static void Main()
    {
        IHandler bare = new BatchOrderHandler();
        IHandler wrapped = new Logging(bare);
        IHandler forwarding = new LoggingForwarding(bare);

        Console.WriteLine("--- 1. a type test sees the wrapper, not the inner object ---");
        Console.WriteLine($"  bare       is IBatchCapable : {bare is IBatchCapable}");
        Console.WriteLine($"  wrapped    is IBatchCapable : {wrapped is IBatchCapable}");
        Console.WriteLine($"  forwarding is IBatchCapable : {forwarding is IBatchCapable}");
        Console.WriteLine("  Wrapping silently removed a capability the caller could detect.");

        Console.WriteLine();
        Console.WriteLine("--- 2. GetType() reports the wrapper ---");
        foreach (var h in new[] { bare, wrapped, forwarding })
            Console.WriteLine($"  Name={h.Name,-8} GetType()={h.GetType().Name}");
        Console.WriteLine("  Logging by GetType().Name now logs 'Logging' for every handler.");

        Console.WriteLine();
        Console.WriteLine("--- 3. reference identity is lost ---");
        Console.WriteLine($"  ReferenceEquals(bare, wrapped) : {ReferenceEquals(bare, wrapped)}");
        var registry = new HashSet<IHandler> { bare };
        Console.WriteLine($"  registry.Contains(bare)    : {registry.Contains(bare)}");
        Console.WriteLine($"  registry.Contains(wrapped) : {registry.Contains(wrapped)}");
        Console.WriteLine("  Any bookkeeping keyed on the object misses the wrapped one.");

        Console.WriteLine();
        Console.WriteLine("--- 4. the forwarding version works, and costs ---");
        Console.WriteLine($"  ((IBatchCapable)forwarding).HandleBatch(3 items) : " +
                          $"{((IBatchCapable)forwarding).HandleBatch(new[] { "a", "b", "c" })}");
        var overNonBatch = new LoggingForwarding(new OrderHandler());
        try
        {
            ((IBatchCapable)overNonBatch).HandleBatch(new[] { "a" });
        }
        catch (NotSupportedException ex)
        {
            Console.WriteLine($"  wrapping a non-batch handler: {ex.GetType().Name}");
        }
        Console.WriteLine("  ...and it now CLAIMS IBatchCapable even when the inner one is not,");
        Console.WriteLine("  so the type test lies in the other direction.");

        Console.WriteLine();
        Console.WriteLine("--- 5. the stack trace goes through every layer ---");
        IHandler deep = new Logging(new Logging(new Logging(new ThrowingHandler())));
        try
        {
            deep.Handle("x");
        }
        catch (InvalidOperationException ex)
        {
            var frames = ex.StackTrace!.Split('\n')
                .Select(l => l.Trim())
                .Where(l => l.StartsWith("at "))
                .ToArray();
            Console.WriteLine($"  frames in the trace: {frames.Length}");
            foreach (var f in frames.Take(6))
                Console.WriteLine($"    {f.Split(" in ")[0]}");
        }
    }
}

sealed class ThrowingHandler : IHandler
{
    public string Name => "throwing";
    public string Handle(string r) => throw new InvalidOperationException("downstream failed");
}
