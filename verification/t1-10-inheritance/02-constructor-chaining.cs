// 02-constructor-chaining.cs — the exact order an object is built in, across
// three levels, and where base(...) arguments are evaluated.
// .NET 10.0.400. Run: dotnet run 02-constructor-chaining.cs

using System;

static class Log
{
    public static string Trace(string what)
    {
        Console.WriteLine($"  {what}");
        return what;
    }
}

class Top
{
    private readonly string _f = Log.Trace("Top     field initialiser");

    public Top(string tag)
    {
        Log.Trace($"Top     constructor body");
    }
}

class Middle : Top
{
    private readonly string _f = Log.Trace("Middle  field initialiser");

    // The argument to base(...) is evaluated BEFORE the base constructor runs,
    // and before this constructor's body.
    public Middle(int n) : base(Log.Trace($"Middle  base(...) argument evaluated"))
    {
        Log.Trace("Middle  constructor body");
    }
}

class Bottom : Middle
{
    private readonly string _f = Log.Trace("Bottom  field initialiser");

    public Bottom() : base(Log.Trace("Bottom  base(...) argument evaluated").Length)
    {
        Log.Trace("Bottom  constructor body");
    }
}

// ---- constructor chaining within one class, via this(...) ------------------
class Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public Money(decimal amount) : this(amount, "GBP")
    {
        Log.Trace("  Money(decimal) body");
    }

    public Money(decimal amount, string currency)
    {
        Log.Trace("  Money(decimal, string) body");
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount));
        Amount = amount;
        Currency = currency;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("Building a Bottom:");
        _ = new Bottom();

        Console.WriteLine();
        Console.WriteLine("this(...) delegates to the other constructor FIRST:");
        var m = new Money(5m);
        Console.WriteLine($"  result: {m.Amount} {m.Currency}");
    }
}
