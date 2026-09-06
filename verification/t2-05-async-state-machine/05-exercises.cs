// 05-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-exercises.cs -c Release
#:property Nullable=enable
#:property NoWarn=IL2026;IL2070;IL2075

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which locals become fields? =====");
        Console.WriteLine();
        Console.WriteLine("  Predict, then read. Three locals, one await, three different fates.");
        Console.WriteLine();
        var t = Machine("ThreeLocals");
        foreach (var f in Hoisted(t))
            Console.WriteLine($"    hoisted : {f}");
        Console.WriteLine();
        Console.WriteLine("    'before' is used only before the await   -> NOT hoisted (a real local)");
        Console.WriteLine("    'across' is used on both sides           -> hoisted");
        Console.WriteLine("    'after'  is assigned after the await     -> NOT hoisted");
        Console.WriteLine("  The rule is liveness, not declaration order: a local is hoisted only");
        Console.WriteLine("  if its value must survive a suspension. This is why moving one line");
        Console.WriteLine("  can change a method's memory profile without changing what it does.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how many state machines does this create? =====");
        Console.WriteLine();
        var all = AllTypes(typeof(Program).Assembly)
            .Where(x => typeof(IAsyncStateMachine).IsAssignableFrom(x) && x != typeof(IAsyncStateMachine))
            .ToArray();
        Console.WriteLine($"  state machines in this assembly : {all.Length}");
        Console.WriteLine("  one per async METHOD and one per async LAMBDA:");
        foreach (var m in all.OrderBy(x => x.Name, StringComparer.Ordinal))
            Console.WriteLine($"    {m.DeclaringType?.Name}.{m.Name}");
        Console.WriteLine();
        Console.WriteLine("  Note that the number of AWAITS does not affect the count. Ten awaits");
        Console.WriteLine("  in one method is one state machine with ten resume points; one await");
        Console.WriteLine("  in each of ten methods is ten state machines.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which of these allocate? =====");
        Console.WriteLine();
        Console.WriteLine("  variant                                bytes/call");
        Console.WriteLine($"    async Task<int>, returns 4242        {Alloc(() => _sink += A().GetAwaiter().GetResult()),8}");
        Console.WriteLine($"    async Task<int>, returns 1           {Alloc(() => _sink += B().GetAwaiter().GetResult()),8}");
        Console.WriteLine($"    async Task (no result)               {Alloc(() => C().GetAwaiter().GetResult()),8}");
        Console.WriteLine($"    async ValueTask<int>, returns 4242   {Alloc(() => _sink += D().GetAwaiter().GetResult()),8}");
        Console.WriteLine($"    async Task<int>, suspends            {Alloc(() => _sink += E().GetAwaiter().GetResult(), 20_000),8}");
        Console.WriteLine();
        Console.WriteLine("  'async Task' with no result allocates nothing on the synchronous path:");
        Console.WriteLine("  there is a shared already-completed Task singleton to hand back. Only");
        Console.WriteLine("  Task<T> for an uncached T has to build one.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: where does the exception surface? =====");
        Console.WriteLine();
        Console.WriteLine("  (a) throw BEFORE the first await, method returns Task");
        var before = ThrowsBeforeAwait();
        Console.WriteLine($"      the call itself returned normally : task status {before.Status}");
        try { before.GetAwaiter().GetResult(); }
        catch (InvalidOperationException ex) { Console.WriteLine($"      it surfaced at the await : {ex.Message}"); }
        Console.WriteLine("      An async method NEVER throws at the call site, even for an");
        Console.WriteLine("      argument check. The exception is captured into the Task.");
        Console.WriteLine("      This is why argument validation belongs in a non-async wrapper:");

        Console.WriteLine();
        Console.WriteLine("  (b) the same check in a non-async wrapper");
        try { ValidatedThrows(null!); }
        catch (ArgumentNullException) { Console.WriteLine("      threw at the CALL SITE, before any Task existed"); }

        Console.WriteLine();
        Console.WriteLine("  (c) throw AFTER an await");
        try { ThrowsAfterAwait().GetAwaiter().GetResult(); }
        catch (InvalidOperationException ex) { Console.WriteLine($"      surfaced at the await : {ex.Message}"); }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: count the suspensions =====");
        Console.WriteLine();
        Console.WriteLine("  Same method, same five awaits, different cache temperature.");
        Console.WriteLine();
        Console.WriteLine("  warm entries   suspensions   bytes/run   ms/run");
        foreach (var warm in new[] { 5, 3, 0 })
        {
            const int Runs = 40;
            FiveLookups(new Cache(warm)).GetAwaiter().GetResult();      // warm up
            GC.Collect();
            GC.WaitForPendingFinalizers();

            var counted = new Cache(warm);
            var sw = Stopwatch.StartNew();
            // Process-wide: the continuations allocate on POOL threads, so the
            // per-thread counter would miss most of it and report the same
            // number for two and five suspensions.
            var bytes = GC.GetTotalAllocatedBytes(precise: true);
            for (var r = 0; r < Runs; r++)
                FiveLookups(counted).GetAwaiter().GetResult();
            bytes = (GC.GetTotalAllocatedBytes(precise: true) - bytes) / Runs;
            Console.WriteLine($"  {warm,12}   {counted.Suspensions / Runs,11}   {bytes,9}   " +
                              $"{sw.Elapsed.TotalMilliseconds / Runs,6:N0}");
        }
        Console.WriteLine();
        Console.WriteLine("  The source code did not change between those three rows. The number");
        Console.WriteLine("  of awaits did not change. What changed is how many of them had to");
        Console.WriteLine("  wait, and that is the only thing the cost depends on.");
        Console.WriteLine("  This is the single most useful idea in the module: async is cheap");
        Console.WriteLine("  when it does not suspend, and you control how often it suspends.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: find the async void =====");
        Console.WriteLine();
        var voids = all.Where(x => x.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
                                    .Any(f => f.FieldType == typeof(AsyncVoidMethodBuilder)))
                       .ToArray();
        Console.WriteLine($"  state machines using AsyncVoidMethodBuilder : {voids.Length}");
        foreach (var v in voids)
            Console.WriteLine($"    {v.DeclaringType?.Name}.{v.Name}");
        Console.WriteLine();
        Console.WriteLine("  Neither of those has the words 'async void' at its declaration. One is");
        Console.WriteLine("  a lambda passed to List<T>.ForEach; the other is passed to a Timer.");
        Console.WriteLine("  Searching the source for 'async void' would find neither.");
        Console.WriteLine("  Reflecting over the builder type finds both, and so does VSTHRD101.");

        Console.WriteLine();
        Console.WriteLine($"  (checksum {_sink})");
    }

    // Exercise 1
    static async Task<int> ThreeLocals(Task gate)
    {
        var before = 1;
        var across = before + 1;
        Console.Out.Flush();
        _sink += before;
        await gate.ConfigureAwait(false);
        var after = across + 1;
        return across + after;
    }

    // Exercise 3
    static async Task<int> A() { await Task.CompletedTask; return 4242; }
    static async Task<int> B() { await Task.CompletedTask; return 1; }
    static async Task C() { await Task.CompletedTask; }
    static async ValueTask<int> D() { await Task.CompletedTask; return 4242; }
    static async Task<int> E() { await Task.Yield(); return 4242; }

    // Exercise 4
    static async Task<int> ThrowsBeforeAwait()
    {
        throw new InvalidOperationException("thrown before any await");
    }

    static Task<int> ValidatedThrows(string input)
    {
        ArgumentNullException.ThrowIfNull(input);
        return Inner();
        static async Task<int> Inner() { await Task.CompletedTask; return 1; }
    }

    static async Task<int> ThrowsAfterAwait()
    {
        await Task.Yield();
        throw new InvalidOperationException("thrown after an await");
    }

    // Exercise 5
    static async Task FiveLookups(Cache cache)
    {
        for (var i = 0; i < 5; i++)
            _sink += await cache.GetAsync(i).ConfigureAwait(false);
    }

    // Exercise 6: two async voids that never say "async void"
    static void RegisterHandlers()
    {
        var items = new List<int> { 1, 2, 3 };
        items.ForEach(async i => { await Task.Delay(i).ConfigureAwait(false); });
        _ = new Timer(async _ => { await Task.Delay(1).ConfigureAwait(false); }, null, -1, -1);
    }

    // --- helpers --------------------------------------------------------------
    static Type Machine(string methodName) =>
        AllTypes(typeof(Program).Assembly).First(t => t.Name.Contains(methodName));

    static string[] Hoisted(Type machine) =>
        machine.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .Where(f => !f.Name.StartsWith("<>", StringComparison.Ordinal))
            .Select(f => $"{f.FieldType.Name} {f.Name}")
            .ToArray();

    static IEnumerable<Type> AllTypes(Assembly assembly)
    {
        var seen = new List<Type>();
        void Walk(Type t)
        {
            seen.Add(t);
            foreach (var n in t.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic))
                Walk(n);
        }
        foreach (var t in assembly.GetTypes())
            if (!t.IsNested) Walk(t);
        return seen;
    }

    static long Alloc(Action a, int reps = 100_000)
    {
        for (var i = 0; i < 1_000; i++) a();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < reps; i++) a();
        return (GC.GetAllocatedBytesForCurrentThread() - before) / reps;
    }
}

/// <summary>A cache with a controllable hit rate, counting its own suspensions.</summary>
sealed class Cache
{
    private readonly int _warmCount;
    private int _suspensions;

    public Cache(int warmCount) => _warmCount = warmCount;
    public int Suspensions => Volatile.Read(ref _suspensions);

    public async ValueTask<int> GetAsync(int key)
    {
        if (key < _warmCount) return key;            // synchronous: no suspension
        Interlocked.Increment(ref _suspensions);
        await Task.Delay(10).ConfigureAwait(false);  // suspends
        return key;
    }
}
