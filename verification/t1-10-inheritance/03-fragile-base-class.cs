// 03-fragile-base-class.cs — the derived class is correct, the base class is
// correct, and together they are wrong. Nothing here is a bug in isolation.
// .NET 10.0.400. Run: dotnet run 03-fragile-base-class.cs

using System;
using System.Collections.Generic;

// ---- the base class, as its author wrote it -------------------------------
class ItemBag
{
    private readonly List<string> _items = new();

    public int Count => _items.Count;

    public virtual void Add(string item) => _items.Add(item);

    // An implementation detail: AddRange happens to be written in terms of Add.
    // Nothing in the public documentation says so.
    public virtual void AddRange(IEnumerable<string> items)
    {
        foreach (var item in items) Add(item);
    }
}

// ---- a derived class, written by someone who never saw the base source -----
class CountingBag : ItemBag
{
    public int Added { get; private set; }

    public override void Add(string item)
    {
        Added++;
        base.Add(item);
    }

    public override void AddRange(IEnumerable<string> items)
    {
        foreach (var item in items) Added++;
        base.AddRange(items);
    }
}

// ---- the same intent, written so the base cannot betray it -----------------
class SafeCountingBag : ItemBag
{
    public int Added { get; private set; }

    public override void Add(string item)
    {
        Added++;
        base.Add(item);
    }
    // No AddRange override. The base's AddRange routes through Add, and if a
    // future version stops doing that, Count and Added still agree because
    // both come from the same place.
}

class Program
{
    static void Main()
    {
        var items = new[] { "a", "b", "c" };

        var bad = new CountingBag();
        bad.AddRange(items);
        Console.WriteLine("CountingBag overrides both Add and AddRange:");
        Console.WriteLine($"  items actually stored : {bad.Count}");
        Console.WriteLine($"  Added reports         : {bad.Added}");
        Console.WriteLine($"  agree?                : {bad.Count == bad.Added}");

        Console.WriteLine();
        var ok = new SafeCountingBag();
        ok.AddRange(items);
        Console.WriteLine("SafeCountingBag overrides only Add:");
        Console.WriteLine($"  items actually stored : {ok.Count}");
        Console.WriteLine($"  Added reports         : {ok.Added}");
        Console.WriteLine($"  agree?                : {ok.Count == ok.Added}");

        Console.WriteLine();
        Console.WriteLine("Each class read on its own looks correct. The defect is in");
        Console.WriteLine("the relationship: AddRange calling Add is invisible from outside.");
    }
}
