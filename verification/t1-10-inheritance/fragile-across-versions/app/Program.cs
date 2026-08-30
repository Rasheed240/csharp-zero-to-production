using System;
using BagLib;

// The careful derived class. It overrides ONLY Add, which is the advice given
// to avoid the double-counting problem. It is never edited again.
class AuditedBag : ItemBag
{
    public int Audited { get; private set; }

    public override void Add(string item)
    {
        Audited++;                 // an audit trail the compliance team relies on
        base.Add(item);
    }
}

class Program
{
    static void Main()
    {
        var bag = new AuditedBag();
        bag.AddRange(new[] { "a", "b", "c" });

        Console.WriteLine($"items stored   : {bag.Count}");
        Console.WriteLine($"audit recorded : {bag.Audited}");
        Console.WriteLine($"agree?         : {bag.Count == bag.Audited}");
    }
}
