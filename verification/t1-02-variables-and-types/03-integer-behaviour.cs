// Demo 3 — the two integer behaviours that silently produce wrong answers.
using System.Globalization;

// Pinned so this program prints identically on every machine, whatever the
// operating system locale happens to be. Demo 6 shows why that matters.
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// --- 1. integer division truncates, it does not round -------------------
int totalPence = 1000;
int customers = 3;
int shareEach = totalPence / customers;

Console.WriteLine("1. integer division");
Console.WriteLine($"   1000 / 3            = {shareEach}   (not 333.33; the remainder is discarded)");
Console.WriteLine($"   1000 % 3            = {totalPence % customers}   (the remainder, if you want it)");
Console.WriteLine($"   7 / 2               = {7 / 2}");
Console.WriteLine($"   7 / 2.0             = {7 / 2.0}   (one operand is a double, so the whole sum is)");
Console.WriteLine($"   (double)7 / 2       = {(double)7 / 2}");
Console.WriteLine($"   unallocated pence   = {totalPence - (shareEach * customers)}");
Console.WriteLine();

// --- 2. overflow wraps around silently, by default ----------------------
Console.WriteLine("2. overflow");
Console.WriteLine($"   int.MaxValue        = {int.MaxValue:N0} pence = {int.MaxValue / 100m:N2} in pounds");

int runningTotal = int.MaxValue - 50;
Console.WriteLine($"   starting at         = {runningTotal:N0}");

for (int i = 0; i < 100; i++)
{
    runningTotal += 1;      // no error, no warning, no exception
}

Console.WriteLine($"   after +100          = {runningTotal:N0}   <-- negative. The money vanished.");
Console.WriteLine();

// --- 3. checked turns that silence into an exception --------------------
Console.WriteLine("3. the same code inside a checked block");
int guarded = int.MaxValue - 50;
try
{
    for (int i = 0; i < 100; i++)
    {
        guarded = checked(guarded + 1);
    }
    Console.WriteLine($"   after +100          = {guarded:N0}");
}
catch (OverflowException ex)
{
    Console.WriteLine($"   threw               = {ex.GetType().Name}: {ex.Message}");
}
Console.WriteLine();

// --- 4. unsigned types wrap at zero too ---------------------------------
Console.WriteLine("4. unsigned wraparound at the bottom");
uint refunds = 0;
Console.WriteLine($"   uint 0 - 1          = {unchecked(refunds - 1):N0}   <-- not -1");
Console.WriteLine();

// --- 5. the size of a literal is decided before assignment --------------
Console.WriteLine("5. literals have types of their own");
long tooBigForInt = 3_000_000_000L;   // the L suffix is required
Console.WriteLine($"   3_000_000_000L      = {tooBigForInt:N0}");
Console.WriteLine($"   int.MaxValue + 1L   = {int.MaxValue + 1L:N0}   (the L makes the whole sum long)");
Console.WriteLine($"   int.MaxValue + 1    = {unchecked(int.MaxValue + 1):N0}   (all int, so it wraps)");
