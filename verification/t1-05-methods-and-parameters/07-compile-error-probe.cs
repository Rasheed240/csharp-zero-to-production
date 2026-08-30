// Compile-error probe. This file is EXPECTED NOT TO COMPILE.
//
// Note on reading the output: the compiler reports the DECLARATION errors
// (CS0111, CS1737) and stops before analysing the call sites. Comment the
// Broken class out to see the call-site errors (CS7036, CS1620, CS1739).
// The lesson quotes all of them together.

Api.Charge(100m);                 // CS7036: no argument for 'feePercent'
Api.Bump(5);                      // CS1620: argument 1 must be passed with 'ref'
Api.Swap(1, 2);                   // CS1620: argument 2 must be passed with 'out'
Api.Charge(100m, rate: 5);        // CS1739: no parameter named 'rate'

public static class Api
{
    public static decimal Charge(decimal amount, int feePercent) => amount;

    public static void Bump(ref int value) => value++;

    public static void Swap(ref int a, out int b) { b = a; }

    public static bool TryGet(out int value)
    {
        // CS0177: the out parameter must be assigned on every path out.
        return false;
    }
}

public static class Broken
{
    // CS0111: the return type is not part of the signature, so these two
    // are the same method declared twice.
    public static int Ambiguous() => 1;
    public static string Ambiguous() => "1";

    // CS1737: an optional parameter cannot come before a required one.
    public static void BadOrder(int optional = 1, int required) { }
}

// Also worth knowing, and not shown here because it needs top-level statements:
// LOCAL FUNCTIONS CANNOT BE OVERLOADED. Declaring two local functions with the
// same name is CS0128, "already defined in this scope", even when their
// parameter types differ. Overloads must live in a class.
