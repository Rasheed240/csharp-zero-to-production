// 01-metadata.cs — what the runtime knows about your types, and how to ask it.
// Every line here reads real metadata out of this assembly.
// .NET 10.0.400. Run: dotnet run 01-metadata.cs
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075;IL2072

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Ledger.Invoicing;

[AttributeUsage(AttributeTargets.Property, AllowMultiple = false)]
public sealed class ColumnAttribute : Attribute
{
    public ColumnAttribute(string name) => Name = name;
    public string Name { get; }
    public bool Indexed { get; init; }
}

public sealed record Invoice
{
    [Column("invoice_number", Indexed = true)]
    public required string Number { get; init; }

    [Column("customer_id", Indexed = true)]
    public required string CustomerId { get; init; }

    [Column("amount_minor")]
    public required long AmountMinor { get; init; }

    // Deliberately unmapped: no attribute.
    public string DisplayName => $"{Number} ({CustomerId})";

    public bool IsLarge(long threshold) => AmountMinor > threshold;
    private void Internal() { }
}

class Program
{
    static void Main()
    {
        var type = typeof(Invoice);

        Console.WriteLine("--- a Type object describes a type ---");
        Console.WriteLine($"  Name          : {type.Name}");
        Console.WriteLine($"  FullName      : {type.FullName}");
        Console.WriteLine($"  Assembly      : {type.Assembly.GetName().Name}");
        Console.WriteLine($"  IsSealed      : {type.IsSealed}");
        Console.WriteLine($"  IsValueType   : {type.IsValueType}");
        Console.WriteLine($"  BaseType      : {type.BaseType?.Name}");

        Console.WriteLine();
        Console.WriteLine("--- three ways to get one ---");
        var invoice = new Invoice { Number = "INV-1", CustomerId = "CUST-1", AmountMinor = 120_00 };
        Console.WriteLine($"  typeof(Invoice)      : {typeof(Invoice).Name}");
        Console.WriteLine($"  invoice.GetType()    : {invoice.GetType().Name}");
        Console.WriteLine($"  Type.GetType(string) : " +
                          $"{Type.GetType("Ledger.Invoicing.Invoice")?.Name ?? "(null)"}");
        Console.WriteLine("  typeof is resolved at COMPILE time and costs nothing at runtime.");
        Console.WriteLine("  GetType() reads the object's type pointer. Type.GetType(string)");
        Console.WriteLine("  searches by name and is the one that breaks under trimming.");

        Console.WriteLine();
        Console.WriteLine("--- public properties, with their attributes ---");
        foreach (var p in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            var column = p.GetCustomAttribute<ColumnAttribute>();
            var mapping = column is null
                ? "(not mapped)"
                : $"-> {column.Name}{(column.Indexed ? " [indexed]" : "")}";
            Console.WriteLine($"  {p.Name,-12} {p.PropertyType.Name,-8} {mapping}");
        }
        Console.WriteLine("  DisplayName has no [Column], so a mapper skips it. The");
        Console.WriteLine("  attribute is the schema; the code is the source of truth.");

        Console.WriteLine();
        Console.WriteLine("--- private members need BindingFlags.NonPublic ---");
        var publicMethods = type.GetMethods(BindingFlags.Public | BindingFlags.Instance).Length;
        var allMethods = type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic |
                                         BindingFlags.Instance).Length;
        Console.WriteLine($"  public instance methods      : {publicMethods}");
        Console.WriteLine($"  plus non-public              : {allMethods}");
        Console.WriteLine($"  the private one, by name     : " +
                          $"{type.GetMethod("Internal", BindingFlags.NonPublic | BindingFlags.Instance)?.Name ?? "(null)"}");
        Console.WriteLine("  BindingFlags is not a filter you add — it REPLACES the default.");
        Console.WriteLine("  Omitting Instance or Static returns nothing at all.");
        Console.WriteLine($"  GetMethods() with only NonPublic : " +
                          $"{type.GetMethods(BindingFlags.NonPublic).Length} members");

        Console.WriteLine();
        Console.WriteLine("--- reading and writing values ---");
        var numberProp = type.GetProperty(nameof(Invoice.Number))!;
        Console.WriteLine($"  GetValue : {numberProp.GetValue(invoice)}");
        Console.WriteLine($"  CanWrite : {numberProp.CanWrite} (init-only, so writable only during init)");
        try
        {
            numberProp.SetValue(invoice, "CHANGED");
            Console.WriteLine($"  after SetValue : {invoice.Number}");
            Console.WriteLine("  Reflection wrote to an init-only property. The 'init'");
            Console.WriteLine("  restriction is enforced by the COMPILER, not the runtime.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  SetValue threw : {ex.GetType().Name}");
        }

        Console.WriteLine();
        Console.WriteLine("--- invoking a method ---");
        var isLarge = type.GetMethod(nameof(Invoice.IsLarge))!;
        Console.WriteLine($"  parameters : {string.Join(", ",
            isLarge.GetParameters().Select(p => $"{p.ParameterType.Name} {p.Name}"))}");
        Console.WriteLine($"  ReturnType : {isLarge.ReturnType.Name}");
        Console.WriteLine($"  Invoke(invoice, 100_00) : {isLarge.Invoke(invoice, new object[] { 100_00L })}");
        Console.WriteLine("  Arguments are boxed into an object[]; the result is boxed too.");

        Console.WriteLine();
        Console.WriteLine("--- what an exception from Invoke looks like ---");
        try
        {
            isLarge.Invoke(invoice, new object[] { "not a long" });
        }
        catch (ArgumentException ex)
        {
            Console.WriteLine($"  wrong argument type : {ex.GetType().Name}");
        }
        var thrower = typeof(Program).GetMethod(nameof(Throws),
            BindingFlags.NonPublic | BindingFlags.Static)!;
        try
        {
            thrower.Invoke(null, null);
        }
        catch (TargetInvocationException ex)
        {
            Console.WriteLine($"  a method that throws : {ex.GetType().Name}");
            Console.WriteLine($"    InnerException     : {ex.InnerException?.GetType().Name}: " +
                              $"{ex.InnerException?.Message}");
        }
        Console.WriteLine("  Invoke WRAPS the real exception in TargetInvocationException.");
        Console.WriteLine("  Any catch clause for the real type will miss it.");

        Console.WriteLine();
        Console.WriteLine("--- creating an instance ---");
        var built = Activator.CreateInstance(typeof(Money), new object[] { 12.5m, "GBP" })!;
        Console.WriteLine($"  Activator.CreateInstance(Money, 12.5, GBP) : {built}");
        var bypassed = (Invoice)Activator.CreateInstance(typeof(Invoice))!;
        Console.WriteLine($"  Activator.CreateInstance(Invoice) : Number = " +
                          $"{(bypassed.Number is null ? "(NULL)" : bypassed.Number)}");
        Console.WriteLine("  Every property is 'required', and reflection created one with");
        Console.WriteLine("  all of them unset. 'required' is a COMPILE-time rule (CS9035);");
        Console.WriteLine("  the runtime has no such concept.");
        Console.WriteLine("  This is how a deserialiser produces an object your type system");
        Console.WriteLine("  says cannot exist — the point measured in the nullable module.");

        Console.WriteLine();
        Console.WriteLine("--- a type that genuinely has no parameterless constructor ---");
        try
        {
            Activator.CreateInstance(typeof(Receipt));
        }
        catch (MissingMethodException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}");
        }
    }

    static void Throws() => throw new InvalidOperationException("from inside");
}

public sealed class Receipt
{
    public Receipt(string number) => Number = number;
    public string Number { get; }
}

public readonly record struct Money(decimal Amount, string Currency)
{
    public override string ToString() => $"{Amount:0.00} {Currency}";
}
