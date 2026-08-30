// 03-default-interface-methods.cs — an interface member with a body. What it
// buys, and the two things about it that surprise people.
// .NET 10.0.400. Run: dotnet run 03-default-interface-methods.cs

using System;

interface IAuditable
{
    string Id { get; }

    // A default interface method: a body, in an interface.
    string AuditLine() => $"audit:{Id}";

    // Defaults can call other members, including ones with no default.
    string AuditLineWithReason(string reason) => $"{AuditLine()} reason={reason}";
}

// Implements only what has no default.
sealed class Payment : IAuditable
{
    public string Id => "PMT-1";
}

// Supplies its own version, which wins.
sealed class Refund : IAuditable
{
    public string Id => "RFD-1";
    public string AuditLine() => $"REFUND-AUDIT:{Id}";
}

// ---- two interfaces with the same member NAME is NOT a diamond -------------
// ILeft.Name and IRight.Name are different members that happen to share a name.
// A class may implement both with no ambiguity at all.
interface ILeft { string Name() => "left"; }
interface IRight { string Name() => "right"; }

sealed class Quiet : ILeft, IRight { }        // compiles; no member of its own

sealed class Both : ILeft, IRight
{
    public string Name() => "the class's own Name";
}

// ---- the REAL diamond: one base member, two competing implementations -----
interface IBase { string Describe(); }
interface IUpper : IBase { string IBase.Describe() => "UPPER"; }
interface ILower : IBase { string IBase.Describe() => "lower"; }

// 'sealed class Ambiguous : IUpper, ILower { }' is CS8705.
// Naming a winner resolves it.
sealed class Resolved : IUpper, ILower
{
    public string Describe() => "resolved explicitly by the class";
}

class Program
{
    static void Main()
    {
        var payment = new Payment();
        var refund = new Refund();

        Console.WriteLine("Through the INTERFACE:");
        Console.WriteLine($"  Payment : {((IAuditable)payment).AuditLine()}");
        Console.WriteLine($"  Refund  : {((IAuditable)refund).AuditLine()}");
        Console.WriteLine($"  Payment : {((IAuditable)payment).AuditLineWithReason("chargeback")}");

        Console.WriteLine();
        Console.WriteLine("Through the CLASS:");
        Console.WriteLine($"  refund.AuditLine()  : {refund.AuditLine()}");
        Console.WriteLine("  payment.AuditLine() : does not compile — CS1061.");
        Console.WriteLine("  A default implementation is a member of the INTERFACE, not of the");
        Console.WriteLine("  class. The class does not inherit it onto its own surface.");

        Console.WriteLine();
        Console.WriteLine("Reflection confirms it:");
        Console.WriteLine($"  typeof(Payment).GetMethod(\"AuditLine\") is null : " +
                          $"{typeof(Payment).GetMethod("AuditLine") is null}");
        Console.WriteLine($"  typeof(IAuditable).GetMethod(\"AuditLine\") is null : " +
                          $"{typeof(IAuditable).GetMethod("AuditLine") is null}");
        var m = typeof(IAuditable).GetMethod("AuditLine")!;
        Console.WriteLine($"  IAuditable.AuditLine IsAbstract={m.IsAbstract} (false = it has a body)");

        Console.WriteLine();
        Console.WriteLine("Two interfaces sharing a member NAME — not a diamond:");
        var quiet = new Quiet();
        Console.WriteLine($"  ((ILeft)quiet).Name()   : {((ILeft)quiet).Name()}");
        Console.WriteLine($"  ((IRight)quiet).Name()  : {((IRight)quiet).Name()}");
        Console.WriteLine("  Quiet declares no Name at all and compiles. The two defaults are");
        Console.WriteLine("  different members; each interface keeps its own. Only");
        Console.WriteLine("  'quiet.Name()' fails, with CS1061 — defaults are not on the class.");

        var both = new Both();
        Console.WriteLine($"  both.Name()            : {both.Name()}");
        Console.WriteLine($"  ((ILeft)both).Name()   : {((ILeft)both).Name()}");
        Console.WriteLine($"  ((IRight)both).Name()  : {((IRight)both).Name()}");

        Console.WriteLine();
        Console.WriteLine("The real diamond — one base member, two implementations:");
        IBase r = new Resolved();
        Console.WriteLine($"  ((IBase)resolved).Describe() : {r.Describe()}");
        Console.WriteLine("  Without the class's own Describe(), this is CS8705:");
        Console.WriteLine("  'Interface member IBase.Describe() does not have a most specific");
        Console.WriteLine("   implementation. Neither IUpper.IBase.Describe(), nor");
        Console.WriteLine("   ILower.IBase.Describe() are most specific.'");
    }
}
