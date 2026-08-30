// 03-raising-and-fixes.cs — raising an event safely, isolating subscribers,
// and the three ways to stop the leak.
// .NET 10.0.400, Release. Run: dotnet run 03-raising-and-fixes.cs -c Release

using System;
using System.Collections.Generic;
using System.Linq;

public sealed class Feed
{
    public event Action<decimal>? PriceChanged;
    public int Subscribers => PriceChanged?.GetInvocationList().Length ?? 0;

    // UNSAFE under threading: the field can become null between the check and
    // the call, and one throwing subscriber stops the rest.
    public void RaiseNaive(decimal p)
    {
        if (PriceChanged != null) PriceChanged(p);
    }

    // Safe against the null race: ?.Invoke reads the field once into a temp.
    public void RaiseSafe(decimal p) => PriceChanged?.Invoke(p);

    // Safe against the null race AND isolates subscribers from each other.
    public IReadOnlyList<string> RaiseIsolated(decimal p)
    {
        var handlers = PriceChanged;              // one read, then work on the copy
        if (handlers is null) return Array.Empty<string>();

        var failures = new List<string>();
        foreach (var h in handlers.GetInvocationList().Cast<Action<decimal>>())
        {
            try { h(p); }
            catch (Exception ex) { failures.Add($"{h.Method.Name}: {ex.GetType().Name}"); }
        }
        return failures;
    }
}

// The fix that needs no discipline from subscribers: the publisher holds them
// weakly, so a subscriber that nothing else references can be collected.
public sealed class WeakFeed
{
    private readonly List<WeakReference<Action<decimal>>> _handlers = new();

    public void Subscribe(Action<decimal> handler) =>
        _handlers.Add(new WeakReference<Action<decimal>>(handler));

    public int LiveSubscribers
    {
        get
        {
            int n = 0;
            foreach (var w in _handlers) if (w.TryGetTarget(out _)) n++;
            return n;
        }
    }

    public void Publish(decimal price)
    {
        for (int i = _handlers.Count - 1; i >= 0; i--)
        {
            if (_handlers[i].TryGetTarget(out var handler)) handler(price);
            else _handlers.RemoveAt(i);              // prune dead entries
        }
    }
}

// The CORRECT weak pattern: hold the TARGET weakly and the method separately.
// Holding the delegate weakly collects too eagerly, because the delegate
// itself usually has no other reference.
public sealed class WeakTargetFeed
{
    private readonly List<(WeakReference Target, System.Reflection.MethodInfo Method)> _handlers = new();

    public void Subscribe(Action<decimal> handler) =>
        _handlers.Add((new WeakReference(handler.Target!), handler.Method));

    public int LiveSubscribers
    {
        get { int n = 0; foreach (var h in _handlers) if (h.Target.IsAlive) n++; return n; }
    }

    public void Publish(decimal price)
    {
        for (int i = _handlers.Count - 1; i >= 0; i--)
        {
            var target = _handlers[i].Target.Target;
            if (target is null) { _handlers.RemoveAt(i); continue; }
            _handlers[i].Method.Invoke(target, new object[] { price });
        }
    }
}

sealed class Widget
{
    private readonly byte[] _buffer = new byte[1024 * 1024];
    public int Received;
    public void OnPrice(decimal p) => Received++;
}

class Program
{
    static int _ok;
    static void Good(decimal p) => _ok++;
    static void Bad(decimal p) => throw new InvalidOperationException("subscriber failed");

    static void Main()
    {
        Console.WriteLine("--- one throwing subscriber, two raise strategies ---");
        var feed = new Feed();
        feed.PriceChanged += Good;
        feed.PriceChanged += Bad;
        feed.PriceChanged += Good;

        _ok = 0;
        try { feed.RaiseSafe(1m); }
        catch (InvalidOperationException) { Console.WriteLine("  RaiseSafe threw to the caller"); }
        Console.WriteLine($"  handlers that succeeded : {_ok} of 2 good ones");

        _ok = 0;
        var failures = feed.RaiseIsolated(1m);
        Console.WriteLine($"  RaiseIsolated succeeded : {_ok} of 2, failures: " +
                          $"{string.Join(", ", failures)}");

        Console.WriteLine();
        Console.WriteLine("--- the null race that ?.Invoke closes ---");
        Console.WriteLine("  if (PriceChanged != null) PriceChanged(p);");
        Console.WriteLine("    reads the field TWICE. Another thread unsubscribing the last");
        Console.WriteLine("    handler between the two reads gives NullReferenceException.");
        Console.WriteLine("  PriceChanged?.Invoke(p);");
        Console.WriteLine("    reads it once into a temporary, so the copy cannot become null.");
        Console.WriteLine("    A handler removed after the read still runs — unavoidable, and");
        Console.WriteLine("    the reason handlers must tolerate being called once more.");

        Console.WriteLine();
        Console.WriteLine("--- weak subscriptions, the NAIVE version ---");
        var naive = new WeakFeed();
        var kept = new Widget();
        naive.Subscribe(kept.OnPrice);
        Console.WriteLine($"  one live subscriber, before GC : {naive.LiveSubscribers}");
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        Console.WriteLine($"  after GC                      : {naive.LiveSubscribers}");
        naive.Publish(42m);
        Console.WriteLine($"  the kept widget received      : {kept.Received}");
        Console.WriteLine("  This survived here, and that is the problem: it is not reliable.");
        Console.WriteLine("  'kept.OnPrice' creates a delegate that NOTHING else references, so");
        Console.WriteLine("  whether the weak reference survives depends on whether anything");
        Console.WriteLine("  happens to root that delegate. A subscription that disappears");
        Console.WriteLine("  unpredictably is worse than one that leaks predictably.");

        Console.WriteLine();
        Console.WriteLine("--- weak subscriptions, holding the TARGET weakly ---");
        var correct = new WeakTargetFeed();
        var kept2 = new Widget();
        correct.Subscribe(kept2.OnPrice);

        var refs = new List<WeakReference>();
        for (int i = 0; i < 5; i++)
        {
            var w = new Widget();
            correct.Subscribe(w.OnPrice);
            refs.Add(new WeakReference(w));
        }

        Console.WriteLine($"  subscribers before GC : {correct.LiveSubscribers}");
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        GC.KeepAlive(kept2);
        Console.WriteLine($"  subscribers after GC  : {correct.LiveSubscribers}");
        Console.WriteLine($"  dropped widgets alive : {refs.FindAll(r => r.IsAlive).Count} of 5");

        correct.Publish(42m);
        Console.WriteLine($"  the kept widget received : {kept2.Received}");
        Console.WriteLine("  The kept subscriber survives and works; the dropped ones were");
        Console.WriteLine("  collected and pruned on the next publish.");
    }
}
