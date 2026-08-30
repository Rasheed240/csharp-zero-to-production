// 04-base-and-hiding.cs — what base. actually does, and what happens when a
// base class grows a member whose name a derived class was already using.
// .NET 10.0.400. Run: dotnet run 04-base-and-hiding.cs

using System;

class Report
{
    public virtual string Render() => "base render";

    // Calls the VIRTUAL method, so it reaches the derived override.
    public string RenderTwice() => Render() + " | " + Render();
}

class PdfReport : Report
{
    public override string Render() => "PDF render";

    // base.Render() is NON-virtual: it calls Report.Render directly, even
    // though this object's Render is overridden.
    public string ShowBoth() => $"this.Render()={Render()}, base.Render()={base.Render()}";
}

// ---- what happens when the base grows a member you already had -------------
class OldBase
{
    public string Describe() => "old base";
}

class Derived : OldBase
{
    // Version 1 of the base had no Describe. This compiled cleanly.
    // Once the base added one, this became an accidental hide: warning CS0108,
    // "hides inherited member. Use the new keyword if hiding was intended."
    public new string Describe() => "derived";
}

class Program
{
    static void Main()
    {
        var pdf = new PdfReport();

        Console.WriteLine("--- virtual dispatch reaches the override ---");
        Console.WriteLine($"  Render()      : {pdf.Render()}");
        Console.WriteLine($"  RenderTwice() : {pdf.RenderTwice()}");
        Console.WriteLine("  (RenderTwice lives on Report and still reached PdfReport.Render)");

        Console.WriteLine();
        Console.WriteLine("--- base. is not virtual ---");
        Console.WriteLine($"  {pdf.ShowBoth()}");

        Console.WriteLine();
        Console.WriteLine("--- hiding: the STATIC type of the variable decides ---");
        Derived d = new Derived();
        OldBase asBase = d;
        Console.WriteLine($"  through Derived : {d.Describe()}");
        Console.WriteLine($"  through OldBase : {asBase.Describe()}");
        Console.WriteLine($"  same object?    : {ReferenceEquals(d, asBase)}");
        Console.WriteLine("  One object, two answers, decided at compile time by the");
        Console.WriteLine("  declared type of the variable rather than by the object.");
    }
}
