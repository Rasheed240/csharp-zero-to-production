// 02-multicast.cs — a delegate can hold a LIST of methods. Almost every
// surprising thing about delegates comes from that.
// .NET 10.0.400. Run: dotnet run 02-multicast.cs

using System;
using System.Linq;

class Holder { public int Twice(int v) => v * 2; }

class Program
{
    static int First(int v) { Console.WriteLine($"    First({v}) -> {v + 1}"); return v + 1; }
    static int Second(int v) { Console.WriteLine($"    Second({v}) -> {v + 2}"); return v + 2; }
    static int Third(int v) { Console.WriteLine($"    Third({v}) -> {v + 3}"); return v + 3; }
    static int Throws(int v) => throw new InvalidOperationException("handler failed");

    static void Main()
    {
        Console.WriteLine("--- combining with += ---");
        Func<int, int> chain = First;
        chain += Second;
        chain += Third;

        Console.WriteLine($"  invocation list length : {chain.GetInvocationList().Length}");
        Console.WriteLine("  calling chain(10):");
        int result = chain(10);
        Console.WriteLine($"  the returned value is  : {result}");
        Console.WriteLine("  ALL THREE ran, and only the LAST return value survived.");
        Console.WriteLine("  The first two results were computed and discarded.");

        Console.WriteLine();
        Console.WriteLine("--- to keep every result, walk the list yourself ---");
        var all = chain.GetInvocationList()
                       .Cast<Func<int, int>>()
                       .Select(f => f(10))
                       .ToArray();
        Console.WriteLine($"  every result: {string.Join(", ", all)}");

        Console.WriteLine();
        Console.WriteLine("--- an exception stops the rest ---");
        Func<int, int> withFailure = First;
        withFailure += Throws;
        withFailure += Third;
        try
        {
            withFailure(10);
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"  caught {ex.GetType().Name}: {ex.Message}");
        }
        Console.WriteLine("  Third never ran. One bad subscriber silences everything after it.");

        Console.WriteLine();
        Console.WriteLine("--- removing with -= ---");
        Func<int, int>? removable = First;
        removable += Second;
        Console.WriteLine($"  before removal : {removable!.GetInvocationList().Length} entries");
        removable -= Second;
        Console.WriteLine($"  after -= Second: {removable!.GetInvocationList().Length} entries");
        Console.WriteLine("  Note the compiler types the result of -= as NULLABLE: removing");
        Console.WriteLine("  the last entry yields null rather than an empty delegate.");

        Console.WriteLine();
        Console.WriteLine("--- but -= with a NEW lambda removes nothing ---");
        Func<int, int>? withLambda = First;
        withLambda += v => v * 10;
        Console.WriteLine($"  after adding a lambda : {withLambda!.GetInvocationList().Length}");
        withLambda -= v => v * 10;               // a DIFFERENT object
        Console.WriteLine($"  after -= (same text)  : {withLambda!.GetInvocationList().Length}");
        Console.WriteLine("  Two lambdas with identical text are two different delegate values.");

        Func<int, int> keep = v => v * 10;
        Func<int, int>? withKept = First;
        withKept += keep;
        withKept -= keep;                        // the SAME object
        Console.WriteLine($"  holding a reference and removing that: " +
                          $"{withKept!.GetInvocationList().Length}");

        Console.WriteLine();
        Console.WriteLine("--- delegate equality is not identity ---");
        Func<int, int> s1 = First, s2 = First;
        Console.WriteLine($"  static method group   : == {s1 == s2,-5}  ReferenceEquals {ReferenceEquals(s1, s2)}");

        var holder = new Holder();
        Func<int, int> i1 = holder.Twice, i2 = holder.Twice;
        Console.WriteLine($"  instance, same object : == {i1 == i2,-5}  ReferenceEquals {ReferenceEquals(i1, i2)}");

        Func<int, int> i3 = new Holder().Twice;
        Console.WriteLine($"  instance, other object: == {i1 == i3,-5}  ReferenceEquals {ReferenceEquals(i1, i3)}");

        Func<int, int> l1 = v => v * 2, l2 = v => v * 2;
        Console.WriteLine($"  two identical lambdas : == {l1 == l2,-5}  ReferenceEquals {ReferenceEquals(l1, l2)}");

        Console.WriteLine("  Row 2 is the one to remember: equal, and NOT the same object.");
        Console.WriteLine("  Equality compares Method and Target. Row 1 is also reference-equal");
        Console.WriteLine("  only because the compiler caches static method group conversions.");
        Console.WriteLine("  Row 4 is why -= with a fresh lambda removes nothing: each lambda");
        Console.WriteLine("  compiles to its own method, so the Methods differ.");

        Console.WriteLine();
        Console.WriteLine("--- removing everything gives null, not an empty delegate ---");
        Func<int, int>? emptied = First;
        emptied -= First;
        Console.WriteLine($"  emptied is null : {emptied is null}");
        Console.WriteLine("  So invoking a delegate field always needs a null check, or ?.Invoke.");
        int? maybe = emptied?.Invoke(1);
        Console.WriteLine($"  emptied?.Invoke(1) returns : {(maybe.HasValue ? maybe.Value.ToString() : "null")}");
    }
}
