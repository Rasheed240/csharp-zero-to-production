// 06-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 06-exercises.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ===== Exercise 1 ==========================================================
record Point(int X, int Y);
record Tagged(string Name, List<string> Tags);
class PlainPoint { public int X { get; init; } public int Y { get; init; } }

// ===== Exercise 3 ==========================================================
record Shape(string Colour);
record Circle(string Colour, int Radius) : Shape(Colour);

// ===== Exercise 4 ==========================================================
struct BadCounter { public int Hits; public void Hit() => Hits++; }

readonly record struct GoodCounter(int Hits)
{
    public GoodCounter Hit() => this with { Hits = Hits + 1 };
}

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1: what == means =====");
        var p1 = new Point(1, 2);
        var p2 = new Point(1, 2);
        Console.WriteLine($"  record: p1 == p2                 : {p1 == p2}");
        Console.WriteLine($"  record: ReferenceEquals(p1, p2)  : {ReferenceEquals(p1, p2)}");
        Console.WriteLine($"  record: p1.ToString()            : {p1}");

        var q1 = new PlainPoint { X = 1, Y = 2 };
        var q2 = new PlainPoint { X = 1, Y = 2 };
        Console.WriteLine($"  class : q1.Equals(q2)            : {q1.Equals(q2)}");

        var t1 = new Tagged("a", new List<string> { "x" });
        var t2 = new Tagged("a", new List<string> { "x" });
        Console.WriteLine($"  record with a List: t1 == t2     : {t1 == t2}");
        Console.WriteLine($"  same contents?                   : {t1.Tags.SequenceEqual(t2.Tags)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: 'with' is shallow =====");
        var original = new Tagged("first", new List<string> { "x" });
        var copy = original with { Name = "second" };
        Console.WriteLine($"  copy.Name                        : {copy.Name}");
        Console.WriteLine($"  same Tags instance?              : {ReferenceEquals(original.Tags, copy.Tags)}");
        copy.Tags.Add("added-to-copy");
        Console.WriteLine($"  original.Tags after copy.Add     : {string.Join(", ", original.Tags)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: record inheritance =====");
        Shape s = new Shape("red");
        Shape c = new Circle("red", 5);
        Console.WriteLine($"  s.Colour == c.Colour             : {s.Colour == c.Colour}");
        Console.WriteLine($"  s == c                           : {s == c}");
        Console.WriteLine($"  c.Equals(s)                      : {c.Equals(s)}");
        Console.WriteLine($"  s.Equals(c)                      : {s.Equals(c)}");
        Console.WriteLine($"  c.ToString()                     : {c}");
        Shape c2 = new Circle("red", 5);
        Console.WriteLine($"  two identical Circles as Shape   : {c == c2}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: mutable struct =====");
        var list = new List<BadCounter> { new BadCounter() };
        list[0].Hit();
        Console.WriteLine($"  List<BadCounter>: after list[0].Hit()  -> {list[0].Hits}");

        var arr = new BadCounter[1];
        arr[0].Hit();
        Console.WriteLine($"  BadCounter[]   : after arr[0].Hit()   -> {arr[0].Hits}");

        var goods = new List<GoodCounter> { new GoodCounter(0) };
        goods[0] = goods[0].Hit();
        Console.WriteLine($"  GoodCounter    : after goods[0] = goods[0].Hit() -> {goods[0].Hits}");

        Console.WriteLine();
        var dict = new Dictionary<GoodCounter, string> { [new GoodCounter(1)] = "one" };
        Console.WriteLine($"  lookup by an equal-but-separate key   : " +
                          $"{dict.ContainsKey(new GoodCounter(1))}");
    }
}
