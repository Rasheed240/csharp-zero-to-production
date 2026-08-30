// Demo 1 — declaring, assigning, defaults, and the rule that stops you reading
// a variable you never gave a value to.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// Declaration and assignment in one step. This is the normal form.
int invoiceCount = 3;
decimal amountDue = 144.00m;
string customerName = "Acme Ltd";
bool isPaid = false;

Console.WriteLine("1. declared and initialised");
Console.WriteLine($"   invoiceCount = {invoiceCount}");
Console.WriteLine($"   amountDue    = {amountDue}");
Console.WriteLine($"   customerName = {customerName}");
Console.WriteLine($"   isPaid       = {isPaid}");
Console.WriteLine();

// Declaration first, assignment later, is also legal.
int retryCount;
retryCount = 0;
retryCount = retryCount + 1;
Console.WriteLine("2. assigned after declaring");
Console.WriteLine($"   retryCount   = {retryCount}");
Console.WriteLine();

// Reading before assigning is a COMPILE error, not a run-time surprise:
//     int neverSet;
//     Console.WriteLine(neverSet);
// error CS0165: Use of unassigned local variable 'neverSet'
Console.WriteLine("3. definite assignment");
Console.WriteLine("   Reading an unassigned local is CS0165, caught by the compiler.");
Console.WriteLine("   There is no such thing as a local variable holding garbage in C#.");
Console.WriteLine();

// Fields of a type, unlike locals, DO get a default value.
Console.WriteLine("4. default values (what a type is worth before you set it)");
Console.WriteLine($"   default(int)      = {default(int)}");
Console.WriteLine($"   default(decimal)  = {default(decimal)}");
Console.WriteLine($"   default(bool)     = {default(bool)}");
Console.WriteLine($"   default(char)     = {(int)default(char)} (the NUL character, printed as its code)");
Console.WriteLine($"   default(DateTime) = {default(DateTime):O}");
Console.WriteLine($"   default(string)   = null   (every reference type defaults to null)");
Console.WriteLine();

Settings settings = new Settings();
Console.WriteLine("   a fresh object's fields take those defaults:");
Console.WriteLine($"   settings.MaxRetries = {settings.MaxRetries}");
Console.WriteLine($"   settings.Timeout    = {settings.Timeout}");
Console.WriteLine();

// Constants are fixed at compile time; readonly is fixed once at construction.
Console.WriteLine("5. values that must not change");
Console.WriteLine($"   PenceInAPound (const)    = {Money.PenceInAPound}");
Money money = new Money(500);
Console.WriteLine($"   money.Pence (readonly)   = {money.Pence}");
Console.WriteLine($"   money.InPounds           = {money.InPounds}");

sealed class Settings
{
    public int MaxRetries { get; set; }
    public TimeSpan Timeout { get; set; }
}

sealed class Money
{
    // const: burned into every assembly that uses it, at compile time.
    public const int PenceInAPound = 100;

    // readonly: set once, in the constructor, then fixed for this instance.
    public readonly int Pence;

    public Money(int pence) => Pence = pence;

    public decimal InPounds => Pence / (decimal)PenceInAPound;
}
