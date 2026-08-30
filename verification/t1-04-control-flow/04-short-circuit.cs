// Demo 4 — && and || stop early. & and | do not. That difference is the
// distance between a working null check and a NullReferenceException.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Customer? missing = null;
Customer present = new Customer("Acme Ltd", "GB");

Console.WriteLine("&& stops as soon as the answer is known");
Console.WriteLine($"  missing is a UK customer : {IsUkCustomerSafe(missing)}");
Console.WriteLine($"  present is a UK customer : {IsUkCustomerSafe(present)}");
Console.WriteLine();

Console.WriteLine("& evaluates both sides, always");
try
{
    Console.WriteLine($"  missing is a UK customer : {IsUkCustomerUnsafe(missing)}");
}
catch (NullReferenceException)
{
    Console.WriteLine("  missing is a UK customer : threw NullReferenceException");
}
Console.WriteLine();

// Proving the short circuit actually skips the call.
Console.WriteLine("counting how many times the right-hand side runs");
Counter counter = new Counter();

bool a = false && counter.ReturnsTrue();
Console.WriteLine($"  false && f()  -> right side called {counter.Calls} time(s)");

counter.Reset();
bool b = false & counter.ReturnsTrue();
Console.WriteLine($"  false &  f()  -> right side called {counter.Calls} time(s)");

counter.Reset();
bool c = true || counter.ReturnsTrue();
Console.WriteLine($"  true  || f()  -> right side called {counter.Calls} time(s)");

counter.Reset();
bool d = true | counter.ReturnsTrue();
Console.WriteLine($"  true  |  f()  -> right side called {counter.Calls} time(s)");

Console.WriteLine();
Console.WriteLine($"(results {a} {b} {c} {d} - identical answers, different work done)");

static bool IsUkCustomerSafe(Customer? customer) =>
    customer is not null && customer.CountryCode == "GB";

static bool IsUkCustomerUnsafe(Customer? customer) =>
    customer is not null & customer!.CountryCode == "GB";

sealed record Customer(string Name, string CountryCode);

sealed class Counter
{
    public int Calls { get; private set; }

    public bool ReturnsTrue()
    {
        Calls++;
        return true;
    }

    public void Reset() => Calls = 0;
}
