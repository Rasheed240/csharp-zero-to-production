// 08-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 08-exercises.cs

using System;
using System.Collections.Generic;

// ===== Exercise 1 ==========================================================
static class T { public static string L(string s) { Console.WriteLine("    " + s); return s; } }

class E1Base
{
    private readonly string _f = T.L("E1Base field initialiser");
    public E1Base() { T.L("E1Base ctor"); Setup(); }
    protected virtual void Setup() => T.L("E1Base.Setup");
}

class E1Derived : E1Base
{
    private readonly string _fromInitialiser = T.L("E1Derived field initialiser");
    private string? _fromCtorBody;

    public E1Derived()
    {
        T.L("E1Derived ctor body");
        _fromCtorBody = "set in ctor body";
    }

    protected override void Setup() =>
        T.L($"E1Derived.Setup sees _fromInitialiser={_fromInitialiser ?? "null"}, " +
            $"_fromCtorBody={_fromCtorBody ?? "null"}");
}

// ===== Exercise 2 ==========================================================
class Shape
{
    public virtual string Draw() => "shape";
    public string Label() => "label:" + Draw();
}

class Circle : Shape
{
    public override string Draw() => "circle";
}

class Square : Shape
{
    public new string Draw() => "square";
}

// ===== Exercise 4 ==========================================================
class BadCache
{
    protected readonly Dictionary<string, string> Store = new();
    protected int Hits;
    public int HitCount => Hits;
    public string? Get(string k) { if (Store.TryGetValue(k, out var v)) { Hits++; return v; } return null; }
    public void Put(string k, string v) => Store[k] = v;
}

class BadCacheWithPrefix : BadCache
{
    public void PutRaw(string k, string v) => Store[k] = v;      // bypasses Put
    public void ResetStats() => Hits = 0;                        // corrupts the metric
}

sealed class GoodCache
{
    private readonly Dictionary<string, string> _store = new();
    private int _hits;
    private readonly Func<string, string> _normalise;

    public GoodCache(Func<string, string>? normalise = null)
        => _normalise = normalise ?? (k => k);

    public int HitCount => _hits;
    public int Count => _store.Count;

    public string? Get(string key)
    {
        if (_store.TryGetValue(_normalise(key), out var v)) { _hits++; return v; }
        return null;
    }

    public void Put(string key, string value) => _store[_normalise(key)] = value;
}

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1: construction order =====");
        _ = new E1Derived();

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: override vs new =====");
        Shape[] asShape = { new Circle(), new Square() };
        Console.WriteLine($"  Shape ref  -> Circle.Draw()  : {asShape[0].Draw()}");
        Console.WriteLine($"  Shape ref  -> Square.Draw()  : {asShape[1].Draw()}");
        Console.WriteLine($"  Circle ref -> Draw()         : {new Circle().Draw()}");
        Console.WriteLine($"  Square ref -> Draw()         : {new Square().Draw()}");
        Console.WriteLine($"  Circle.Label()               : {new Circle().Label()}");
        Console.WriteLine($"  Square.Label()               : {new Square().Label()}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: protected state =====");
        var bad = new BadCacheWithPrefix();
        bad.Put("a", "1");
        bad.PutRaw("B", "2");
        _ = bad.Get("a");
        _ = bad.Get("a");
        Console.WriteLine($"  before reset, hits: {bad.HitCount}");
        bad.ResetStats();
        Console.WriteLine($"  after  reset, hits: {bad.HitCount}  (metric silently zeroed)");

        var good = new GoodCache(k => k.ToLowerInvariant());
        good.Put("A", "1");
        good.Put("a", "2");
        Console.WriteLine($"  GoodCache normalises: Count={good.Count}, Get(\"A\")={good.Get("A")}");
        Console.WriteLine($"  GoodCache hits: {good.HitCount}");
    }
}
