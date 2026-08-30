#:property NoWarn=IL2075

// 04-override-new-sealed.cs — the four things you can do to an inherited
// virtual member, and what each does to the method table slot.
// .NET 10.0.400. Run: dotnet run 04-override-new-sealed.cs

using System;
using System.Linq;
using System.Reflection;

class Renderer
{
    public virtual string Render() => "base";
    public virtual string Header() => "base header";
}

// 1. override — takes over the existing slot
class HtmlRenderer : Renderer
{
    public override string Render() => "html";

    // 2. sealed override — takes the slot and closes it to further overriding
    public sealed override string Header() => "html header";
}

// 3. no member at all — inherits whatever the slot points at
class PlainHtmlRenderer : HtmlRenderer { }

// 4. new — a separate member; the slot is untouched
class BrokenRenderer : Renderer
{
    public new string Render() => "broken";
}

// ---- covariant return types (C# 9 and later) ------------------------------
class Document { public virtual string Kind => "document"; }
class Invoice : Document { public override string Kind => "invoice"; }

class DocumentFactory
{
    public virtual Document Create() => new Document();
}

class InvoiceFactory : DocumentFactory
{
    // The override may return a MORE DERIVED type than the base declared.
    public override Invoice Create() => new Invoice();
}

class Program
{
    static void Main()
    {
        Renderer[] all = { new Renderer(), new HtmlRenderer(),
                           new PlainHtmlRenderer(), new BrokenRenderer() };

        Console.WriteLine("Called through a Renderer reference:");
        foreach (var r in all)
            Console.WriteLine($"  {r.GetType().Name,-20} Render()={r.Render(),-8} Header()={r.Header()}");

        Console.WriteLine();
        Console.WriteLine("Called through each object's own type:");
        Console.WriteLine($"  BrokenRenderer.Render()      : {new BrokenRenderer().Render()}");
        Console.WriteLine($"  PlainHtmlRenderer.Render()   : {new PlainHtmlRenderer().Render()}");

        Console.WriteLine();
        Console.WriteLine("Which declaration owns the slot, per runtime type:");
        foreach (var r in all)
        {
            var mi = r.GetType().GetMethod("Render")!;
            Console.WriteLine($"  {r.GetType().Name,-20} Render resolves to {mi.DeclaringType!.Name}.Render " +
                              $"(IsVirtual={mi.IsVirtual}, IsFinal={mi.IsFinal})");
        }

        Console.WriteLine();
        var hdr = typeof(HtmlRenderer).GetMethod("Header")!;
        Console.WriteLine($"HtmlRenderer.Header IsVirtual={hdr.IsVirtual}, IsFinal={hdr.IsFinal}");
        Console.WriteLine("  IsFinal=True is what 'sealed override' produces: still in the slot,");
        Console.WriteLine("  but no further class may replace it.");

        Console.WriteLine();
        Console.WriteLine("Covariant return types:");
        DocumentFactory f = new InvoiceFactory();
        Document viaBase = f.Create();
        Invoice viaDerived = new InvoiceFactory().Create();   // no cast needed
        Console.WriteLine($"  through DocumentFactory : {viaBase.GetType().Name} ({viaBase.Kind})");
        Console.WriteLine($"  through InvoiceFactory  : {viaDerived.GetType().Name} ({viaDerived.Kind})");
        Console.WriteLine($"  base declares return    : {typeof(DocumentFactory).GetMethod("Create")!.ReturnType.Name}");
        Console.WriteLine($"  override declares return: {typeof(InvoiceFactory).GetMethod("Create")!.ReturnType.Name}");
    }
}
