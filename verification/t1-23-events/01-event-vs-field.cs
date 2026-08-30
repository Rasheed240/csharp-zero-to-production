// 01-event-vs-field.cs — what the 'event' keyword actually restricts, and why
// a public delegate field is not the same thing.
// .NET 10.0.400. Run: dotnet run 01-event-vs-field.cs

#:property NoWarn=IL2070

using System;
using System.Linq;
using System.Reflection;

public sealed class Publisher
{
    // A public delegate FIELD. Anyone can read it, replace it, or invoke it.
    public Action<string>? OpenField;

    // An EVENT. Outside code may only += and -=.
    public event Action<string>? RealEvent;

    public void RaiseBoth(string message)
    {
        OpenField?.Invoke(message);
        RealEvent?.Invoke(message);
    }

    public int FieldSubscribers => OpenField?.GetInvocationList().Length ?? 0;
    public int EventSubscribers => RealEvent?.GetInvocationList().Length ?? 0;
}

class Program
{
    static void Main()
    {
        var p = new Publisher();
        p.OpenField += m => Console.WriteLine($"    field handler A: {m}");
        p.OpenField += m => Console.WriteLine($"    field handler B: {m}");
        p.RealEvent += m => Console.WriteLine($"    event handler A: {m}");
        p.RealEvent += m => Console.WriteLine($"    event handler B: {m}");

        Console.WriteLine("--- both raise the same way from inside ---");
        p.RaiseBoth("hello");
        Console.WriteLine($"  field subscribers: {p.FieldSubscribers}, " +
                          $"event subscribers: {p.EventSubscribers}");

        Console.WriteLine();
        Console.WriteLine("--- what outside code can do to a FIELD ---");
        p.OpenField = m => Console.WriteLine($"    REPLACED everything: {m}");
        Console.WriteLine($"  after outside assignment, field subscribers: {p.FieldSubscribers}");
        p.OpenField?.Invoke("raised from outside");
        Console.WriteLine("  Outside code replaced both handlers and raised the notification.");

        Console.WriteLine();
        Console.WriteLine("--- what outside code can do to an EVENT ---");
        Console.WriteLine("  p.RealEvent = ...        does not compile (CS0070)");
        Console.WriteLine("  p.RealEvent.Invoke(...)  does not compile (CS0070)");
        Console.WriteLine("  p.RealEvent += handler   is the ONLY thing permitted");
        Console.WriteLine($"  event subscribers still: {p.EventSubscribers}");

        Console.WriteLine();
        Console.WriteLine("--- what the compiler generated for the event ---");
        var t = typeof(Publisher);
        var ev = t.GetEvent("RealEvent")!;
        Console.WriteLine($"  event name        : {ev.Name}");
        Console.WriteLine($"  add method        : {ev.AddMethod?.Name}");
        Console.WriteLine($"  remove method     : {ev.RemoveMethod?.Name}");

        var backing = t.GetField("RealEvent", BindingFlags.NonPublic | BindingFlags.Instance);
        Console.WriteLine($"  backing field     : {backing?.Name} " +
                          $"(IsPrivate={backing?.IsPrivate})");

        var openField = t.GetField("OpenField");
        Console.WriteLine($"  the plain field   : {openField?.Name} " +
                          $"(IsPublic={openField?.IsPublic})");

        Console.WriteLine();
        Console.WriteLine("  An event is a private delegate field plus two public methods.");
        Console.WriteLine("  The keyword does not change how it is raised — it changes who is");
        Console.WriteLine("  allowed to raise it and who is allowed to replace it.");

        Console.WriteLine();
        Console.WriteLine("--- public members of Publisher ---");
        foreach (var m in t.GetMembers(BindingFlags.Public | BindingFlags.Instance |
                                       BindingFlags.DeclaredOnly)
                          .Select(x => $"{x.MemberType} {x.Name}")
                          .OrderBy(x => x))
            Console.WriteLine($"  {m}");
    }
}
