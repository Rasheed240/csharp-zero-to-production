using System;
using Lib;

// A type in ANOTHER assembly that inherits from Widget.
class ForeignDerived : Widget
{
    public string WhatICanSee()
    {
        // PrivateProtected does NOT compile here: "private protected" means
        // derived AND same assembly. This is a different assembly.
        return $"Public={Public} Protected={Protected} " +
               $"ProtectedInternal={ProtectedInternal}";
    }
}

class Program
{
    static void Main()
    {
        var w = new Widget();

        // Internal is visible only because of InternalsVisibleTo("Consumer").
        Console.WriteLine($"Public   = {w.Public}");
        Console.WriteLine($"Internal = {w.Internal}   (only via InternalsVisibleTo)");
        Console.WriteLine($"ProtectedInternal = {w.ProtectedInternal}   (internal half applies)");
        Console.WriteLine($"all, from inside Lib: {w.All()}");
        Console.WriteLine($"from a foreign subclass: {new ForeignDerived().WhatICanSee()}");
    }
}
