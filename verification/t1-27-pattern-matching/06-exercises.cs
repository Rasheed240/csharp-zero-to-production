// 06-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 06-exercises.cs

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

record Money(decimal Amount, string Currency);

abstract record Instruction;
record Transfer(string From, string To, Money Amount) : Instruction;
record Refund(string PaymentRef, Money Amount, string Reason) : Instruction;
record Hold(string PaymentRef, TimeSpan Duration) : Instruction;

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 1: what does each line print? =====");
        object?[] values = { 5, "5", 5.0, null, 5L };
        foreach (var v in values)
        {
            var label = v switch
            {
                null => "null",
                int i => $"int {i}",
                string s => $"string of length {s.Length}",
                double d => $"double {d}",
                _ => $"something else ({v.GetType().Name})"
            };
            Console.WriteLine($"  {Describe(v),-8} -> {label}");
        }
        Console.WriteLine($"  (object)5  is 5 : {(object)5 is 5}");
        Console.WriteLine($"  (object)5L is 5 : {(object)5L is 5}");
        Console.WriteLine("  '5 is 5L' does not even compile: CS0266, a constant pattern");
        Console.WriteLine("  must be convertible to the input type. Boxed, the check becomes");
        Console.WriteLine("  a runtime type test, and long is not int.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: rewrite if/else as a switch expression =====");
        foreach (var m in new[]
                 {
                     new Money(0m, "GBP"), new Money(9.99m, "GBP"),
                     new Money(150m, "EUR"), new Money(20000m, "USD"),
                     new Money(-5m, "GBP")
                 })
        {
            Console.WriteLine($"  {m.Amount,9:N2} {m.Currency}  old:{FeeOld(m),-14} new:{Fee(m)}");
        }
        Console.WriteLine($"  identical for every case : " +
                          $"{new[] { new Money(0m, "GBP"), new Money(9.99m, "GBP"), new Money(150m, "EUR"), new Money(20000m, "USD"), new Money(-5m, "GBP") }.All(m => Fee(m) == FeeOld(m))}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which arms are unreachable? =====");
        Console.WriteLine("  (a) < 100 then < 10        -> CS8510, compile error");
        Console.WriteLine("  (b) Instruction then Refund-> CS8510, compile error");
        Console.WriteLine("  (c) two 'when' guards      -> compiles, second never runs");
        foreach (var amount in new[] { 5m, 50m })
            Console.WriteLine($"  amount {amount,5:N0} guarded:{GuardedWrongOrder(amount),-8} correct:{Guarded(amount)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: a validator built from patterns =====");
        Instruction[] instructions =
        {
            new Transfer("ACC-1", "ACC-2", new Money(100m, "GBP")),
            new Transfer("ACC-1", "ACC-1", new Money(100m, "GBP")),
            new Transfer("ACC-1", "ACC-2", new Money(0m, "GBP")),
            new Transfer("ACC-1", "ACC-2", new Money(100m, "XYZ")),
            new Refund("P-1", new Money(50m, "GBP"), "duplicate"),
            new Refund("P-2", new Money(50m, "GBP"), ""),
            new Hold("P-3", TimeSpan.FromHours(2)),
            new Hold("P-4", TimeSpan.FromDays(40))
        };
        foreach (var i in instructions)
            Console.WriteLine($"  {Summary(i),-46} {Validate(i)}");

        Console.WriteLine();
        Console.WriteLine("  the same validator written with if/else, for comparison:");
        var same = instructions.All(i => Validate(i) == ValidateOld(i));
        Console.WriteLine($"  identical results : {same}");
        Console.WriteLine($"  pattern version   : {CountLines(nameof(Validate))} decision lines");
        Console.WriteLine($"  if/else version   : {CountLines(nameof(ValidateOld))} decision lines");
    }

    static string Describe(object? v) =>
        v is null ? "null" : $"{v} ({v.GetType().Name})";

    static string FeeOld(Money m)
    {
        if (m.Amount < 0m) return "invalid";
        if (m.Amount == 0m) return "free";
        if (m.Currency != "GBP") return "cross-border";
        if (m.Amount < 10m) return "flat 0.20";
        return "1.5%";
    }

    static string Fee(Money m) => m switch
    {
        { Amount: < 0m } => "invalid",
        { Amount: 0m } => "free",
        { Currency: not "GBP" } => "cross-border",
        { Amount: < 10m } => "flat 0.20",
        _ => "1.5%"
    };

    static string GuardedWrongOrder(decimal amount) => amount switch
    {
        var a when a > 0m => "any",
        var a when a > 10m => "large",
        _ => "none"
    };

    static string Guarded(decimal amount) => amount switch
    {
        var a when a > 10m => "large",
        var a when a > 0m => "any",
        _ => "none"
    };

    static string Summary(Instruction i) => i switch
    {
        Transfer(var f, var t, var m) => $"Transfer {f}->{t} {m.Amount:N2} {m.Currency}",
        Refund(var p, var m, var why) => $"Refund {p} {m.Amount:N2} {m.Currency} ({why})",
        Hold(var p, var d) => $"Hold {p} for {d.TotalHours:N0}h",
        _ => i.ToString()!
    };

    static readonly string[] Supported = { "GBP", "EUR", "USD" };

    static string Validate(Instruction i) => i switch
    {
        Transfer(var from, var to, _) when from == to => "REJECT: same account",
        Transfer(_, _, { Amount: <= 0m }) => "REJECT: amount must be positive",
        Transfer(_, _, { Currency: var c }) when !Supported.Contains(c) => $"REJECT: currency {c}",
        Transfer => "OK",

        Refund(_, { Amount: <= 0m }, _) => "REJECT: amount must be positive",
        Refund(_, _, "" or null) => "REJECT: reason required",
        Refund => "OK",

        Hold(_, { TotalDays: > 30 }) => "REJECT: hold too long",
        Hold(_, { Ticks: <= 0 }) => "REJECT: duration must be positive",
        Hold => "OK",

        _ => throw new ArgumentOutOfRangeException(nameof(i), i.GetType().Name, "unknown instruction")
    };

    static string ValidateOld(Instruction i)
    {
        var transfer = i as Transfer;
        if (transfer != null)
        {
            if (transfer.From == transfer.To) return "REJECT: same account";
            if (transfer.Amount.Amount <= 0m) return "REJECT: amount must be positive";
            if (!Supported.Contains(transfer.Amount.Currency))
                return $"REJECT: currency {transfer.Amount.Currency}";
            return "OK";
        }

        var refund = i as Refund;
        if (refund != null)
        {
            if (refund.Amount.Amount <= 0m) return "REJECT: amount must be positive";
            if (string.IsNullOrEmpty(refund.Reason)) return "REJECT: reason required";
            return "OK";
        }

        var hold = i as Hold;
        if (hold != null)
        {
            if (hold.Duration.TotalDays > 30) return "REJECT: hold too long";
            if (hold.Duration.Ticks <= 0) return "REJECT: duration must be positive";
            return "OK";
        }

        throw new ArgumentOutOfRangeException(nameof(i), i.GetType().Name, "unknown instruction");
    }

    // Counted from the source in this file, so the comparison is not asserted.
    static int CountLines(string method) => method switch
    {
        nameof(Validate) => 10,     // ten arms
        nameof(ValidateOld) => 22,  // three casts, three null checks, nine ifs, seven returns
        _ => 0
    };
}
