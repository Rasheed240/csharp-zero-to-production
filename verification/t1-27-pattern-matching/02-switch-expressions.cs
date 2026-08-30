// 02-switch-expressions.cs — the switch expression, what exhaustiveness actually
// guarantees (less than you would think), and where the compiler stops helping.
// The diagnostics themselves are in 03-compile-errors.cs.txt.
// .NET 10.0.400. Run: dotnet run 02-switch-expressions.cs

using System;
using System.Collections.Generic;
using System.Linq;

enum PaymentState { Pending, Settled, Failed, Refunded }

abstract record Event;
record Created(string Ref) : Event;
record Authorised(string Ref, decimal Amount) : Event;
record Captured(string Ref, decimal Amount) : Event;
record PaymentFailed(string Ref, string Reason) : Event;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- statement vs expression: the same decision, twice ---");
        foreach (var s in Enum.GetValues<PaymentState>())
            Console.WriteLine($"  {s,-9} statement:{AsStatement(s),-9} expression:{AsExpression(s)}");

        Console.WriteLine();
        Console.WriteLine("--- an enum switch covering every NAME is still not exhaustive ---");
        var rogue = (PaymentState)99;
        Console.WriteLine($"  (PaymentState)99 is a defined value : {Enum.IsDefined(rogue)}");
        Console.WriteLine($"  ...and it prints as                 : {rogue}");
        Console.WriteLine("  An enum is an int with names on some of its values. Any int");
        Console.WriteLine("  can be cast to it — from a database column, a JSON body, or");
        Console.WriteLine("  a cast in your own code. The compiler knows, and says so:");
        Console.WriteLine("    warning CS8524: ... it is not exhaustive ... involving an");
        Console.WriteLine("    unnamed enum value. For example, the pattern (PaymentState)4");
        Console.WriteLine("    is not covered.");

        Console.WriteLine();
        Console.WriteLine("--- what happens at runtime with no matching arm ---");
        try { Console.WriteLine(Unhandled(rogue)); }
        catch (Exception ex) { Console.WriteLine($"  {ex.GetType().Name}: {ex.Message}"); }
        Console.WriteLine("  A switch expression must produce a value. With nothing to");
        Console.WriteLine("  produce it throws SwitchExpressionException. The message names");
        Console.WriteLine("  the value but not the parameter, the method, or the file.");

        try { Console.WriteLine(WithExplicitThrow(rogue)); }
        catch (ArgumentOutOfRangeException ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message.Split('(')[0].Trim()}");
            Console.WriteLine($"    ParamName={ex.ParamName}, ActualValue={ex.ActualValue}");
        }
        Console.WriteLine("  An explicit throwing arm costs one line and names the value.");

        Console.WriteLine();
        Console.WriteLine("--- a record hierarchy is NOT closed either ---");
        Event[] events = { new Created("P-1"), new Authorised("P-2", 50m),
                           new Captured("P-3", 50m), new PaymentFailed("P-4", "insufficient funds") };
        foreach (var e in events) Console.WriteLine($"  {Summarise(e)}");
        Console.WriteLine("  Every subtype declared in this file is listed above, and the");
        Console.WriteLine("  compiler STILL warns CS8509 without a discard arm: C# has no");
        Console.WriteLine("  closed hierarchy. Another assembly can derive from Event.");
        Console.WriteLine("  Sealing the subtypes does not help; sealing Event would stop");
        Console.WriteLine("  derivation but then it could not have subtypes at all.");

        Console.WriteLine();
        Console.WriteLine("--- arm ORDER: the compiler catches some mistakes, not all ---");
        Console.WriteLine("  Relational arms in the wrong order are a compile ERROR:");
        Console.WriteLine("    CS8510: The pattern is unreachable. It has already been");
        Console.WriteLine("    handled by a previous arm of the switch expression.");
        Console.WriteLine("  (see 03-compile-errors.cs.txt)");
        Console.WriteLine();
        Console.WriteLine("  So are property-pattern arms: { Amount: > 0m } placed before");
        Console.WriteLine("  { Amount: > 1000m } is CS8510 as well.");
        Console.WriteLine();
        Console.WriteLine("  What it CANNOT analyse is the CONTENT of a when guard. This");
        Console.WriteLine("  builds with no diagnostic and the second arm never runs:");
        var authorisations = events.OfType<Authorised>()
            .Concat(new[] { new Authorised("P-9", 5000m) }).ToArray();
        foreach (var a in authorisations)
            Console.WriteLine($"    {a.Ref} {a.Amount,7:N0} -> {RouteWrongOrder(a)}");
        Console.WriteLine("  Correct order:");
        foreach (var a in authorisations)
            Console.WriteLine($"    {a.Ref} {a.Amount,7:N0} -> {Route(a)}");

        Console.WriteLine();
        Console.WriteLine("--- switch expressions are expressions: they compose ---");
        var total = events
            .Select(e => e switch
            {
                Authorised a => a.Amount,
                Captured c => c.Amount,
                _ => 0m
            })
            .Sum();
        Console.WriteLine($"  total carried by events : {total:N2}");
        Console.WriteLine("  A switch STATEMENT cannot go there without a block and a");
        Console.WriteLine("  return. That is the practical difference between the two.");

        Console.WriteLine();
        Console.WriteLine("--- and they nest ---");
        foreach (var e in events)
            Console.WriteLine($"  {Detail(e)}");
    }

    static string AsStatement(PaymentState s)
    {
        switch (s)
        {
            case PaymentState.Pending: return "waiting";
            case PaymentState.Settled: return "done";
            case PaymentState.Failed: return "failed";
            case PaymentState.Refunded: return "reversed";
            default: return "unknown";
        }
    }

    static string AsExpression(PaymentState s) => s switch
    {
        PaymentState.Pending => "waiting",
        PaymentState.Settled => "done",
        PaymentState.Failed => "failed",
        PaymentState.Refunded => "reversed",
        _ => "unknown"
    };

    // No arm for unnamed values. CS8524 is suppressed here ONLY so this file
    // builds clean while demonstrating the runtime consequence.
#pragma warning disable CS8524
    static string Unhandled(PaymentState s) => s switch
    {
        PaymentState.Pending => "waiting",
        PaymentState.Settled => "done",
        PaymentState.Failed => "failed",
        PaymentState.Refunded => "reversed"
    };
#pragma warning restore CS8524

    static string WithExplicitThrow(PaymentState s) => s switch
    {
        PaymentState.Pending => "waiting",
        PaymentState.Settled => "done",
        PaymentState.Failed => "failed",
        PaymentState.Refunded => "reversed",
        _ => throw new ArgumentOutOfRangeException(nameof(s), s, "unhandled payment state")
    };

    static string Summarise(Event e) => e switch
    {
        Created(var r) => $"{r} created",
        Authorised(var r, var a) => $"{r} authorised for {a:N2}",
        Captured(var r, var a) => $"{r} captured {a:N2}",
        PaymentFailed(var r, var why) => $"{r} failed: {why}",
        _ => throw new ArgumentOutOfRangeException(nameof(e), e, "unknown event type")
    };

    // Builds without a single diagnostic. The second arm is unreachable, and the
    // compiler does not analyse the CONTENT of a when guard, so it cannot say so.
    static string RouteWrongOrder(Authorised a) => a switch
    {
        Authorised x when x.Amount > 0m => "auto capture",
        Authorised x when x.Amount > 1000m => "manual review",
        _ => "reject"
    };

    static string Route(Authorised a) => a switch
    {
        Authorised x when x.Amount > 1000m => "manual review",
        Authorised x when x.Amount > 0m => "auto capture",
        _ => "reject"
    };

    static string Detail(Event e)
    {
        var size = e switch
        {
            Authorised(_, < 100m) => "small",
            Authorised(_, < 1000m) => "normal",
            Authorised => "large",
            _ => ""
        };
        return e switch
        {
            Authorised(var r, _) => $"{r}: {size} authorisation",
            Captured(var r, _) => $"{r}: captured",
            Created(var r) => $"{r}: created",
            PaymentFailed(var r, var why) => $"{r}: failed ({why})",
            _ => "unknown"
        };
    }
}
