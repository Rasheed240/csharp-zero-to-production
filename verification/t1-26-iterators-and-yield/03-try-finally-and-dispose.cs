// 03-try-finally-and-dispose.cs — when the finally block in an iterator runs,
// and the two ways it silently does not. This is the mechanism behind every
// "the file handle stayed open" bug in streaming code.
// .NET 10.0.400. Run: dotnet run 03-try-finally-and-dispose.cs

using System;
using System.Collections.Generic;

class Program
{
    static IEnumerable<int> Guarded(string label)
    {
        Console.WriteLine($"    [{label}] opening");
        try
        {
            yield return 1;
            yield return 2;
            yield return 3;
        }
        finally
        {
            Console.WriteLine($"    [{label}] CLOSING");
        }
    }

    static void Main()
    {
        Console.WriteLine("--- running to the end: finally runs ---");
        foreach (var n in Guarded("complete")) Console.WriteLine($"  got {n}");

        Console.WriteLine();
        Console.WriteLine("--- breaking out early: finally STILL runs ---");
        foreach (var n in Guarded("break"))
        {
            Console.WriteLine($"  got {n}");
            if (n == 2) break;
        }
        Console.WriteLine("  foreach compiles to try/finally { enumerator.Dispose(); },");
        Console.WriteLine("  and Dispose on an iterator runs its finally blocks.");

        Console.WriteLine();
        Console.WriteLine("--- an exception in the loop body: finally runs ---");
        try
        {
            foreach (var n in Guarded("throw"))
            {
                Console.WriteLine($"  got {n}");
                if (n == 2) throw new InvalidOperationException("boom");
            }
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine("  caught outside the loop");
        }

        Console.WriteLine();
        Console.WriteLine("--- abandoning the enumerator without disposing: finally does NOT run ---");
        var e = Guarded("abandoned").GetEnumerator();
        e.MoveNext();
        Console.WriteLine($"  pulled {e.Current} and walked away");
        e = null!;
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        Console.WriteLine("  after a full GC: no CLOSING line above.");
        Console.WriteLine("  The generated class has no finaliser. Nothing will ever run");
        Console.WriteLine("  that finally block. A file handle here stays open until the");
        Console.WriteLine("  process exits.");

        Console.WriteLine();
        Console.WriteLine("--- stepping by hand: dispose it yourself ---");
        var e2 = Guarded("manual").GetEnumerator();
        try
        {
            e2.MoveNext();
            Console.WriteLine($"  pulled {e2.Current}");
        }
        finally
        {
            e2.Dispose();
        }

        Console.WriteLine();
        Console.WriteLine("--- Dispose is idempotent, and MoveNext after it returns false ---");
        var e3 = Guarded("twice").GetEnumerator();
        e3.MoveNext();
        e3.Dispose();
        e3.Dispose();
        Console.WriteLine($"  MoveNext after Dispose : {e3.MoveNext()}");
        Console.WriteLine("  Only one CLOSING line above, and no exception.");

        Console.WriteLine();
        Console.WriteLine("--- what you cannot write: yield inside a try WITH a catch ---");
        Console.WriteLine("  CS1626: 'Cannot yield a value in the body of a try block with");
        Console.WriteLine("  a catch clause.' try/finally is allowed; try/catch is not.");
        Console.WriteLine("  Verified in 06-compile-errors.cs.txt, stored as .txt because it");
        Console.WriteLine("  is meant not to build. CS1631 and CS1623 are in there too.");
    }
}
