// 01-flow-analysis.cs — what the compiler tracks, how it narrows, and the exact
// points where it gives up. Every claim here is a compiler diagnostic or a
// printed runtime value, not an assertion.
// .NET 10.0.400. Run: dotnet run 01-flow-analysis.cs
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Linq;

class Program
{
    static string? _cache;
    static int _reads;

    // A property whose backing store can change between two reads.
    static string? Volatile
    {
        get { _reads++; return _reads % 2 == 1 ? "first" : null; }
    }

    static void Main()
    {
        Console.WriteLine("--- the annotation is the whole difference ---");
        string notNull = "value";
        string? maybeNull = null;
        Console.WriteLine($"  string  declared, holds : {notNull}");
        Console.WriteLine($"  string? declared, holds : {maybeNull ?? "(null)"}");
        Console.WriteLine("  Both are System.String at runtime. The ? is metadata the");
        Console.WriteLine("  compiler reads and the runtime ignores entirely.");
        Console.WriteLine($"  both locals report the same runtime type : " +
                          $"{notNull.GetType() == (maybeNull?.GetType() ?? typeof(string))}");
        Console.WriteLine("  typeof(string?) does not even compile: CS8639, 'The typeof");
        Console.WriteLine("  operator cannot be used on a nullable reference type' — there");
        Console.WriteLine("  is no such type for it to name.");

        Console.WriteLine();
        Console.WriteLine("--- narrowing: the compiler follows the control flow ---");
        string? input = Environment.TickCount > 0 ? "present" : null;

        if (input is not null)
        {
            // No warning here: inside this branch the compiler knows it is not null.
            Console.WriteLine($"  inside 'is not null' : length {input.Length}");
        }

        if (input == null) return;
        // After an early return on null, it is non-null for the rest of the method.
        Console.WriteLine($"  after an early return : length {input.Length}");

        Console.WriteLine();
        Console.WriteLine("--- dereferencing is itself an assertion ---");
        string? probably = "x";
        Console.WriteLine($"  probably.Length : {probably.Length}");
        string stillFine = probably;   // no CS8600: line above proved it non-null
        Console.WriteLine($"  assigned to a non-nullable local afterwards, no warning");
        Console.WriteLine("  If it HAD been null, the line above would have thrown, so");
        Console.WriteLine("  reaching the next line proves it was not. That is why");
        Console.WriteLine("  'x.Foo(); string y = x;' produces exactly one warning.");
        Console.WriteLine($"  (value carried forward: {stillFine})");

        Console.WriteLine();
        Console.WriteLine("--- where it is UNSOUND: a property read twice ---");
        _reads = 0;
        if (Volatile is not null)
        {
            // No warning on this line. The compiler narrowed the property after
            // the check — and this second read is a second call to the getter.
            try
            {
                Console.WriteLine($"  compiler says non-null; actual length : {Volatile.Length}");
            }
            catch (NullReferenceException)
            {
                Console.WriteLine("  NullReferenceException — on a line the compiler approved.");
            }
        }
        _reads = 0;
        if (Volatile is not null)
        {
            var second = Volatile;
            Console.WriteLine($"  first read non-null, second read actually : {second ?? "(null)"}");
        }
        Console.WriteLine("  Two reads of a property are two CALLS to its getter, and the");
        Console.WriteLine("  compiler narrows across them anyway — no warning on the second");
        Console.WriteLine("  dereference. That is unsound, and it is how a property backed");
        Console.WriteLine("  by a cache, a lazy field or a request context produces a");
        Console.WriteLine("  NullReferenceException on a line the compiler approved.");
        Console.WriteLine("  The fix: read once into a local. 'var v = Volatile; if (v is");
        Console.WriteLine("  not null) ...' — then there is only one value to reason about.");

        Console.WriteLine();
        Console.WriteLine("--- where it stops: across a method call ---");
        _cache = "set";
        if (_cache is not null)
        {
            Clear();
            Console.WriteLine($"  after Clear(), the field is : {_cache ?? "(null)"}");
        }
        Console.WriteLine("  The compiler DID keep treating _cache as non-null after the");
        Console.WriteLine("  call — it does not model what a method does to a field. That");
        Console.WriteLine("  is unsound, and deliberately so: modelling it would require");
        Console.WriteLine("  whole-program analysis.");

        Console.WriteLine();
        Console.WriteLine("--- where it stops: collections and indexers ---");
        var byId = new Dictionary<string, string?> { ["a"] = "A", ["b"] = null };
        foreach (var key in new[] { "a", "b" })
        {
            var value = byId[key];
            Console.WriteLine($"  byId[{key}] = {value ?? "(null)"}");
        }
        var list = new List<string?> { "x", null };
        var nonNulls = list.Where(x => x is not null).ToList();
        Console.WriteLine($"  after Where(x => x is not null), element type is still string?");
        Console.WriteLine($"    count {nonNulls.Count}, and the compiler still warns on .Length");
        Console.WriteLine("    unless you use OfType<string>() or a null-forgiving operator.");
        Console.WriteLine($"  OfType<string>() count : {list.OfType<string>().Count()}");

        Console.WriteLine();
        Console.WriteLine("--- the runtime does not enforce any of it ---");
        var sneaked = MakeNull<string>();
        Console.WriteLine($"  a 'string' local holding null : {sneaked is null}");
        Console.WriteLine("  Nothing threw. Nullable reference types are a compile-time");
        Console.WriteLine("  analysis; there is no runtime check anywhere.");
    }

    static void Clear() => _cache = null;

    // Generic code without a class constraint can produce null for a reference T
    // without any warning, because T might legitimately be a nullable type.
    static T MakeNull<T>() => default!;
}
