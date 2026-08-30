// 02-loop-capture.cs — the most-reported closure bug, and why C# 5 fixed half
// of it and deliberately left the other half alone.
// .NET 10.0.400. Run: dotnet run 02-loop-capture.cs

using System;
using System.Collections.Generic;

class Program
{
    static void Main()
    {
        Console.WriteLine("--- foreach: each iteration gets its OWN variable (since C# 5) ---");
        var fromForeach = new List<Func<string>>();
        foreach (var name in new[] { "alpha", "beta", "gamma" })
            fromForeach.Add(() => name);
        Console.WriteLine($"  {string.Join(", ", fromForeach.ConvertAll(f => f()))}");

        Console.WriteLine();
        Console.WriteLine("--- for: ONE variable shared by every iteration ---");
        var fromFor = new List<Func<int>>();
        for (int i = 0; i < 3; i++)
            fromFor.Add(() => i);
        Console.WriteLine($"  {string.Join(", ", fromFor.ConvertAll(f => f()))}");
        Console.WriteLine("  All three read the same i, which is 3 by the time they run.");

        Console.WriteLine();
        Console.WriteLine("--- the fix: copy into a variable scoped to the iteration ---");
        var fixedUp = new List<Func<int>>();
        for (int i = 0; i < 3; i++)
        {
            int copy = i;
            fixedUp.Add(() => copy);
        }
        Console.WriteLine($"  {string.Join(", ", fixedUp.ConvertAll(f => f()))}");

        Console.WriteLine();
        Console.WriteLine("--- why for was left alone: the loop variable is meant to be shared ---");
        int shared = 0;
        Action increment = () => shared++;
        for (int i = 0; i < 3; i++) increment();
        Console.WriteLine($"  a lambda mutating an outer variable across iterations: {shared}");
        Console.WriteLine("  Changing 'for' semantics would have broken code like this, so the");
        Console.WriteLine("  language changed only 'foreach', where a per-iteration variable is");
        Console.WriteLine("  what everyone already expected.");

        Console.WriteLine();
        Console.WriteLine("--- the same trap with tasks, which is where it usually bites ---");
        var results = new List<string>();
        var actions = new List<Action>();
        for (int i = 0; i < 3; i++)
            actions.Add(() => results.Add($"for-{i}"));
        foreach (var a in actions) a();
        Console.WriteLine($"  captured by 'for'     : {string.Join(", ", results)}");

        results.Clear();
        actions.Clear();
        foreach (var i in new[] { 0, 1, 2 })
            actions.Add(() => results.Add($"foreach-{i}"));
        foreach (var a in actions) a();
        Console.WriteLine($"  captured by 'foreach' : {string.Join(", ", results)}");

        Console.WriteLine();
        Console.WriteLine("--- static lambdas refuse to capture at all ---");
        int outer = 5;
        Func<int, int> nonCapturing = static x => x * 2;
        Console.WriteLine($"  static lambda works   : {nonCapturing(21)}");
        Console.WriteLine("  'static x => x * outer' does not compile — CS8820. The keyword");
        Console.WriteLine("  turns an accidental capture into a compile error.");
        Console.WriteLine($"  (outer is {outer}, and the static lambda cannot see it)");
    }
}
