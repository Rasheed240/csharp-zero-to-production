// 01-what-lock-is.cs — what the lock keyword compiles to, what it guarantees,
// and the four objects you must not lock on. Also System.Threading.Lock, which
// .NET 9 added and which changes what "lock" means when the target is that type.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-what-lock-is.cs -c Release
#:property Nullable=enable
// CS9216 is suppressed ONLY for BoxedLockUsesMonitor, which converts a Lock to
// object on purpose to demonstrate the trap. The compiler warns about this by
// default, which is the good news reported in section 3 below.
#:property NoWarn=CS9216

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static readonly object Gate = new();
    static readonly Lock ModernGate = new();          // System.Threading.Lock, .NET 9+
    static int _depth;

    static void Main()
    {
        Console.WriteLine("=== 1. what the keyword expands to ===");
        Console.WriteLine();
        Console.WriteLine("  You write:");
        Console.WriteLine("      lock (gate) { Body(); }");
        Console.WriteLine();
        Console.WriteLine("  The compiler emits, for a plain object:");
        Console.WriteLine("      var taken = false;");
        Console.WriteLine("      try { Monitor.Enter(gate, ref taken); Body(); }");
        Console.WriteLine("      finally { if (taken) Monitor.Exit(gate); }");
        Console.WriteLine();
        Console.WriteLine("  Three things follow from that shape, and all three matter.");
        Console.WriteLine();
        Console.WriteLine("  The finally means an exception inside the body RELEASES the lock.");
        Console.WriteLine("  A throw cannot leave a monitor held, which is the main reason to");
        Console.WriteLine("  prefer the keyword over calling Monitor directly.");
        Console.WriteLine();
        Console.WriteLine("  The 'taken' flag exists because Monitor.Enter can be interrupted");
        Console.WriteLine("  between acquiring and returning. Without it, a finally could try to");
        Console.WriteLine("  exit a monitor it never entered.");
        Console.WriteLine();
        Console.WriteLine("  And the lock is on an OBJECT, not on the data. Nothing connects the");
        Console.WriteLine("  gate to the fields it protects except your discipline. The compiler");
        Console.WriteLine("  will not tell you that one method locked and another did not.");

        Console.WriteLine();
        Console.WriteLine("=== 2. a monitor is reentrant ===");
        Console.WriteLine();
        _depth = 0;
        Recursive(3);
        Console.WriteLine($"  the same thread entered the same lock {_depth} times, nested");
        Console.WriteLine($"  IsEntered from inside  : {InsideCheck()}");
        Console.WriteLine();
        Console.WriteLine("  A thread that already holds a monitor can enter it again; the");
        Console.WriteLine("  runtime keeps a count and releases on the matching exit. That makes");
        Console.WriteLine("  recursion and calling a locked method from another locked method");
        Console.WriteLine("  work without thought.");
        Console.WriteLine();
        Console.WriteLine("  It also hides a design problem. If method A locks and calls B which");
        Console.WriteLine("  locks the same gate, the invariant A was protecting is visible to B");
        Console.WriteLine("  midway through A's mutation. Reentrancy means that compiles, runs,");
        Console.WriteLine("  and produces a torn view rather than a deadlock.");
        Console.WriteLine();
        Console.WriteLine("  Note that SemaphoreSlim (t2-14) is NOT reentrant: the same pattern");
        Console.WriteLine("  there deadlocks instantly. Neither behaviour is better; they fail");
        Console.WriteLine("  differently, and knowing which you are holding matters.");

        Console.WriteLine();
        Console.WriteLine("=== 3. System.Threading.Lock, new in .NET 9 ===");
        Console.WriteLine();
        Console.WriteLine($"  typeof(Lock).FullName : {typeof(Lock).FullName}");
        Console.WriteLine();
        Console.WriteLine("  When the target of lock() is a System.Threading.Lock rather than a");
        Console.WriteLine("  plain object, the compiler emits something different:");
        Console.WriteLine();
        Console.WriteLine("      using (gate.EnterScope()) { Body(); }");
        Console.WriteLine();
        Console.WriteLine("  It is faster, it cannot be locked on by accident from elsewhere,");
        Console.WriteLine("  and it exposes the operations the old form hid behind Monitor:");
        Console.WriteLine();
        using (ModernGate.EnterScope())
        {
            Console.WriteLine($"    IsHeldByCurrentThread inside : {ModernGate.IsHeldByCurrentThread}");
        }
        Console.WriteLine($"    IsHeldByCurrentThread outside: {ModernGate.IsHeldByCurrentThread}");
        Console.WriteLine($"    TryEnter succeeded           : {TryModern()}");
        Console.WriteLine();
        Console.WriteLine("  THE TRAP: if you declare the field as object rather than Lock, you");
        Console.WriteLine("  silently get the old Monitor behaviour, because the compiler chooses");
        Console.WriteLine("  on the STATIC type of the expression. These two lines are not the");
        Console.WriteLine("  same:");
        Console.WriteLine();
        Console.WriteLine("      private readonly Lock _gate = new();      // EnterScope");
        Console.WriteLine("      private readonly object _gate = new Lock(); // Monitor");
        Console.WriteLine();
        Console.WriteLine($"  proof — lock(object holding a Lock) still uses Monitor : " +
                          $"{BoxedLockUsesMonitor()}");
        Console.WriteLine();
        Console.WriteLine("  The compiler does warn, and the warning is specific:");
        Console.WriteLine();
        Console.WriteLine("      warning CS9216: A value of type System.Threading.Lock converted");
        Console.WriteLine("      to a different type will use likely unintended monitor-based");
        Console.WriteLine("      locking in lock statement.");
        Console.WriteLine();
        Console.WriteLine("  This file suppresses CS9216 because it needs the wrong version in");
        Console.WriteLine("  order to demonstrate it. Do not suppress it in real code — it fires");
        Console.WriteLine("  exactly when you have silently lost the new behaviour.");
        Console.WriteLine();
        Console.WriteLine("  Its limit: it fires on a CONVERSION it can see. A field already");
        Console.WriteLine("  declared as object, assigned a Lock elsewhere, produces no warning at");
        Console.WriteLine("  the lock site, because by then there is nothing to convert.");

        Console.WriteLine();
        Console.WriteLine("=== 4. the four things you must not lock on ===");
        Console.WriteLine();
        Console.WriteLine("  (a) 'this'          — anything holding a reference to your object");
        Console.WriteLine("                        can lock it and block you, or deadlock you.");
        Console.WriteLine("  (b) a Type object   — typeof(X) is shared by the whole process,");
        Console.WriteLine("                        including code you did not write.");
        Console.WriteLine("  (c) a string        — literals are INTERNED, so the same text");
        Console.WriteLine("                        anywhere in the process is the same object.");
        Console.WriteLine("  (d) a value type    — boxing means every lock() takes a different");
        Console.WriteLine("                        object, so nothing is excluded at all.");
        Console.WriteLine();
        Console.WriteLine("  (c) is the one people do not believe. Two independently written");
        Console.WriteLine("  classes locking on \"cache-lock\" share one monitor:");
        Console.WriteLine();
        Console.WriteLine($"    ReferenceEquals(\"ledger-lock\", MakeSameLiteral()) : " +
                          $"{ReferenceEquals("ledger-lock", MakeSameLiteral())}");
        Console.WriteLine();
        Console.WriteLine("  (d) does not compile in modern C# — lock() on a value type is an");
        Console.WriteLine("  error, CS0185. That is a rare case of the language preventing the");
        Console.WriteLine("  mistake outright rather than leaving it to review.");
        Console.WriteLine();
        Console.WriteLine("  The rule: a private readonly field, of type Lock on .NET 9+ or");
        Console.WriteLine("  object before it, used for one purpose and never exposed.");

        Console.WriteLine();
        Console.WriteLine("=== 5. you cannot await inside a lock ===");
        Console.WriteLine();
        Console.WriteLine("      lock (_gate) { await FetchAsync(); }   // CS1996");
        Console.WriteLine();
        Console.WriteLine("  This is a compiler error, not a warning, and it is a good one. A");
        Console.WriteLine("  monitor is owned by a THREAD, and an await can resume on a different");
        Console.WriteLine("  thread (t2-05), which would try to release a lock it does not hold.");
        Console.WriteLine();
        Console.WriteLine("  The wrong response is to block instead:");
        Console.WriteLine();
        Console.WriteLine("      lock (_gate) { var x = FetchAsync().Result; }   // compiles, awful");
        Console.WriteLine();
        Console.WriteLine("  That holds the monitor for the whole I/O operation, serialising every");
        Console.WriteLine("  caller behind it on top of the starvation from t2-07.");
        Console.WriteLine();
        Console.WriteLine("  The right response is SemaphoreSlim with WaitAsync (t2-14), which is");
        Console.WriteLine("  not thread-owned and can therefore be held across an await.");
    }

    static void Recursive(int n)
    {
        lock (Gate)
        {
            _depth++;
            if (n > 1) Recursive(n - 1);
        }
    }

    static bool InsideCheck()
    {
        lock (Gate) return Monitor.IsEntered(Gate);
    }

    static bool TryModern()
    {
        if (!ModernGate.TryEnter()) return false;
        try { return true; }
        finally { ModernGate.Exit(); }
    }

    /// <summary>
    /// The same Lock instance, seen through an object-typed local. The compiler
    /// picks Monitor because the STATIC type is object — so IsHeldByCurrentThread
    /// stays false even while the lock statement is executing.
    /// </summary>
    static bool BoxedLockUsesMonitor()
    {
        var typedAsObject = (object)ModernGate;
        lock (typedAsObject)
        {
            // If this were EnterScope, the Lock would report itself as held.
            return !ModernGate.IsHeldByCurrentThread;
        }
    }

    static string MakeSameLiteral() => "ledger-lock";
}
