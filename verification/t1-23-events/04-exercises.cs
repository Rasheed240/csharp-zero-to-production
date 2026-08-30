// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400, Release. Run: dotnet run 04-exercises.cs -c Release

using System;
using System.Collections.Generic;
using System.Linq;

public sealed class Feed
{
    public event Action<decimal>? Changed;
    public Action<decimal>? OpenField;
    public int Subscribers => Changed?.GetInvocationList().Length ?? 0;
    public void Raise(decimal p) => Changed?.Invoke(p);
    public IReadOnlyList<string> RaiseIsolated(decimal p)
    {
        var handlers = Changed;
        if (handlers is null) return Array.Empty<string>();
        var failures = new List<string>();
        foreach (var h in handlers.GetInvocationList().Cast<Action<decimal>>())
        {
            try { h(p); } catch (Exception ex) { failures.Add($"{h.Method.Name}:{ex.GetType().Name}"); }
        }
        return failures;
    }
}

sealed class Subscriber
{
    private readonly byte[] _buffer = new byte[1024 * 1024];
    private readonly Feed _feed;
    public int Seen;
    public Subscriber(Feed feed) { _feed = feed; _feed.Changed += OnChanged; }
    private void OnChanged(decimal p) => Seen++;
    public void Unsubscribe() => _feed.Changed -= OnChanged;
}

class Program
{
    static int _ran;
    static void Ok(decimal p) => _ran++;
    static void Fails(decimal p) => throw new InvalidOperationException("nope");

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: what event restricts =====");
        var f = new Feed();
        f.Changed += Ok;
        f.OpenField += Ok;
        Console.WriteLine($"  event subscribers      : {f.Subscribers}");
        Console.WriteLine("  f.Changed = null;        does not compile (CS0070)");
        Console.WriteLine("  f.Changed.Invoke(1m);    does not compile (CS0070)");
        f.OpenField = null;
        Console.WriteLine($"  but the field could be nulled from outside: " +
                          $"{(f.OpenField is null ? "yes" : "no")}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: the leak =====");
        var feed = new Feed();
        var refs = new List<WeakReference>();
        for (int i = 0; i < 5; i++) refs.Add(new WeakReference(new Subscriber(feed)));
        Console.WriteLine($"  subscribers on the feed : {feed.Subscribers}");
        Collect();
        Console.WriteLine($"  subscribers alive       : {refs.Count(r => r.IsAlive)} of 5");
        feed.Raise(1m);
        Console.WriteLine("  and they all still ran when the event was raised.");

        var feed2 = new Feed();
        var refs2 = new List<WeakReference>();
        for (int i = 0; i < 5; i++)
        {
            var s = new Subscriber(feed2);
            refs2.Add(new WeakReference(s));
            s.Unsubscribe();
        }
        Collect();
        Console.WriteLine($"  with Unsubscribe: subscribers {feed2.Subscribers}, " +
                          $"alive {refs2.Count(r => r.IsAlive)} of 5");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: one throwing subscriber =====");
        var f3 = new Feed();
        f3.Changed += Ok;
        f3.Changed += Fails;
        f3.Changed += Ok;

        _ran = 0;
        try { f3.Raise(1m); }
        catch (InvalidOperationException) { Console.WriteLine("  naive raise: threw to the caller"); }
        Console.WriteLine($"  handlers that ran : {_ran} of 2");

        _ran = 0;
        var failures = f3.RaiseIsolated(1m);
        Console.WriteLine($"  isolated raise    : {_ran} of 2 ran, failures: " +
                          $"{string.Join(", ", failures)}");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: lambda subscriptions =====");
        var f4 = new Feed();
        f4.Changed += p => { };
        Console.WriteLine($"  after += a lambda            : {f4.Subscribers}");
        f4.Changed -= p => { };
        Console.WriteLine($"  after -= an identical lambda : {f4.Subscribers}");

        Action<decimal> kept = p => { };
        f4.Changed += kept;
        Console.WriteLine($"  after += a kept lambda       : {f4.Subscribers}");
        f4.Changed -= kept;
        Console.WriteLine($"  after -= the kept reference  : {f4.Subscribers}");
    }

    static void Collect()
    {
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
    }
}
