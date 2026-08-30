// 07-access-modifiers.cs — what each modifier permits, and what you get when
// you write none. .NET 10.0.400. Run: dotnet run 07-access-modifiers.cs

using System;
using System.Linq;
using System.Reflection;

class Base
{
    private int _private = 1;
    protected int Protected = 2;
    internal int Internal = 3;
    protected internal int ProtectedInternal = 4;   // protected OR internal
    private protected int PrivateProtected = 5;     // protected AND internal
    public int Public = 6;

    int _noModifier = 7;                            // members default to private

    public string WhatBaseCanSee() =>
        $"{_private} {Protected} {Internal} {ProtectedInternal} {PrivateProtected} " +
        $"{Public} {_noModifier}";
}

class Derived : Base
{
    public string WhatADerivedTypeCanSee()
    {
        // _private and _noModifier do not compile here.
        return $"Protected={Protected} Internal={Internal} " +
               $"ProtectedInternal={ProtectedInternal} " +
               $"PrivateProtected={PrivateProtected} Public={Public}";
    }
}

class Outside
{
    public string WhatAnUnrelatedTypeCanSee(Base b)
    {
        // Protected, PrivateProtected, _private and _noModifier do not compile here.
        // Internal and ProtectedInternal DO, because this is the same assembly.
        return $"Internal={b.Internal} ProtectedInternal={b.ProtectedInternal} " +
               $"Public={b.Public}";
    }
}

class NoModifierType { }        // top-level types default to internal

public class PublicType { }

class Program
{
    static void Main()
    {
        Console.WriteLine("--- defaults, read back off the compiled metadata ---");
        Report(typeof(NoModifierType));
        Report(typeof(PublicType));
        Console.WriteLine();

        var noMod = typeof(Base).GetField("_noModifier",
            BindingFlags.NonPublic | BindingFlags.Instance)!;
        Console.WriteLine($"member with no modifier '_noModifier': " +
                          $"IsPrivate={noMod.IsPrivate}, IsPublic={noMod.IsPublic}");

        Console.WriteLine();
        Console.WriteLine("--- how the runtime names each level ---");
        foreach (var f in typeof(Base)
                 .GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                 .OrderBy(f => f.Name))
        {
            Console.WriteLine($"  {f.Name,-20} {Describe(f)}");
        }

        Console.WriteLine();
        Console.WriteLine("--- who can actually read what ---");
        Console.WriteLine($"  the declaring type : {new Base().WhatBaseCanSee()}");
        Console.WriteLine($"  a derived type     : {new Derived().WhatADerivedTypeCanSee()}");
        Console.WriteLine($"  an unrelated type  : {new Outside().WhatAnUnrelatedTypeCanSee(new Base())}");
    }

    static void Report(Type t) =>
        Console.WriteLine($"  {t.Name,-16} IsPublic={t.IsPublic,-6} IsNotPublic={t.IsNotPublic}");

    static string Describe(FieldInfo f) =>
        f.IsPrivate ? "private"
        : f.IsFamily ? "protected (family)"
        : f.IsAssembly ? "internal (assembly)"
        : f.IsFamilyOrAssembly ? "protected internal (family OR assembly)"
        : f.IsFamilyAndAssembly ? "private protected (family AND assembly)"
        : f.IsPublic ? "public"
        : "?";
}
