// 06-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 06-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;

// ===== Exercise 1 ==========================================================
class Vehicle
{
    public virtual string Wheels() => "4";
    public string Describe() => $"{GetType().Name} with {Wheels()} wheels";
}
class Motorbike : Vehicle { public override string Wheels() => "2"; }
class Truck : Vehicle { public new string Wheels() => "6"; }

// ===== Exercise 2 ==========================================================
abstract class Middleware
{
    private Middleware? _next;
    public Middleware Then(Middleware next) { _next = next; return next; }
    public string Handle(string request)
    {
        var handled = Process(request);
        return _next is null ? handled : _next.Handle(handled);
    }
    protected abstract string Process(string request);
}
sealed class Upper : Middleware { protected override string Process(string r) => r.ToUpperInvariant(); }
sealed class Tag : Middleware { protected override string Process(string r) => $"[{r}]"; }
sealed class Trim : Middleware { protected override string Process(string r) => r.Trim(); }

// ===== Exercise 4 ==========================================================
class Serialiser
{
    public virtual string Write(object o) => $"object:{o}";
}
class JsonSerialiser : Serialiser
{
    public override string Write(object o) => $"json:{o}";
    public string Write(string s) => $"json-string:{s}";      // overload, not override
}

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1 =====");
        Vehicle[] vs = { new Vehicle(), new Motorbike(), new Truck() };
        foreach (var v in vs)
            Console.WriteLine($"  as Vehicle : {v.Describe()}   (Wheels()={v.Wheels()})");
        Console.WriteLine($"  new Truck().Wheels()      = {new Truck().Wheels()}");
        Console.WriteLine($"  new Truck().Describe()    = {new Truck().Describe()}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2 =====");
        var head = new Trim();
        head.Then(new Upper()).Then(new Tag());
        Console.WriteLine($"  Handle(\"  hello  \") = {head.Handle("  hello  ")}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4 =====");
        Serialiser s = new JsonSerialiser();
        object boxed = "text";
        string raw = "text";
        Console.WriteLine($"  s.Write(raw)                    = {s.Write(raw)}");
        Console.WriteLine($"  ((JsonSerialiser)s).Write(raw)  = {((JsonSerialiser)s).Write(raw)}");
        Console.WriteLine($"  ((JsonSerialiser)s).Write(boxed)= {((JsonSerialiser)s).Write(boxed)}");
        Console.WriteLine($"  new JsonSerialiser().Write(raw) = {new JsonSerialiser().Write(raw)}");
    }
}
