// Demo 4 — why money must never be a double.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// --- 1. the classic ------------------------------------------------------
Console.WriteLine("1. the sum everyone has seen");
double a = 0.1;
double b = 0.2;
Console.WriteLine($"   0.1 + 0.2           = {a + b}");
Console.WriteLine($"   0.1 + 0.2 == 0.3    = {a + b == 0.3}");
Console.WriteLine($"   to 20 decimals      = {(a + b).ToString("F20")}");
Console.WriteLine($"   0.1 itself is       = {a.ToString("F20")}");
Console.WriteLine();

Console.WriteLine("   the same three values as decimal:");
decimal da = 0.1m;
decimal db = 0.2m;
Console.WriteLine($"   0.1m + 0.2m         = {da + db}");
Console.WriteLine($"   0.1m + 0.2m == 0.3m = {da + db == 0.3m}");
Console.WriteLine();

// --- 2. the error compounds ---------------------------------------------
Console.WriteLine("2. one million transactions of 0.01");
const int Transactions = 1_000_000;

double doubleTotal = 0.0;
for (int i = 0; i < Transactions; i++)
{
    doubleTotal += 0.01;
}

decimal decimalTotal = 0m;
for (int i = 0; i < Transactions; i++)
{
    decimalTotal += 0.01m;
}

Console.WriteLine($"   expected            = {10000m}");
Console.WriteLine($"   double  total       = {doubleTotal.ToString("F10")}");
Console.WriteLine($"   decimal total       = {decimalTotal}");
Console.WriteLine($"   double is off by    = {(decimal)doubleTotal - 10000m}");
Console.WriteLine();

// --- 3. what that costs in the smallest unit of currency -----------------
decimal drift = Math.Abs((decimal)doubleTotal - 10000m);
Console.WriteLine($"   drift in pence      = {drift * 100m:F6}");
Console.WriteLine();

// --- 4. why: 0.1 has no exact binary representation ---------------------
Console.WriteLine("4. the reason");
Console.WriteLine($"   1.0 / 3.0 in double = {(1.0 / 3.0).ToString("F20")}   (a third is inexact in base 10 too)");
Console.WriteLine($"   0.5  is exact       = {0.5 + 0.25 == 0.75}   (halves and quarters are powers of two)");
Console.WriteLine($"   0.1  is not         = {0.1 + 0.2 == 0.3}");
Console.WriteLine();

// --- 5. and comparison is therefore unsafe ------------------------------
Console.WriteLine("5. comparing doubles");
double balance = 0.0;
for (int i = 0; i < 10; i++)
{
    balance += 0.1;
}
Console.WriteLine($"   0.1 added ten times = {balance.ToString("F20")}");
Console.WriteLine($"   == 1.0              = {balance == 1.0}");
Console.WriteLine($"   within a tolerance  = {Math.Abs(balance - 1.0) < 1e-9}");
