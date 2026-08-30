// 02-the-leak.cs — a subscription is a reference held by the PUBLISHER to the
// SUBSCRIBER. If the publisher lives longer, the subscriber cannot be
// collected, and nothing in the subscriber's code says so.
// .NET 10.0.400, Release. Run: dotnet run 02-the-leak.cs -c Release

using System;
using System.Collections.Generic;

public sealed class MarketFeed                 // long-lived: created once at startup
{
    public event Action<decimal>? PriceChanged;
    public int Subscribers => PriceChanged?.GetInvocationList().Length ?? 0;
    public void Publish(decimal price) => PriceChanged?.Invoke(price);
}

public sealed class PriceWidget                // short-lived: one per screen
{
    private readonly byte[] _renderBuffer = new byte[2 * 1024 * 1024];   // 2 MB
    private readonly MarketFeed _feed;
    public decimal Last { get; private set; }

    public PriceWidget(MarketFeed feed)
    {
        _feed = feed;
        _feed.PriceChanged += OnPriceChanged;      // the subscription
    }

    private void OnPriceChanged(decimal price) => Last = price;

    public void Dispose() => _feed.PriceChanged -= OnPriceChanged;
}

class Program
{
    static void Main()
    {
        var feed = new MarketFeed();

        Console.WriteLine("--- 1. widgets that never unsubscribe ---");
        var refs = new List<WeakReference>();
        for (int i = 0; i < 5; i++)
        {
            var w = new PriceWidget(feed);
            refs.Add(new WeakReference(w));
        }
        Console.WriteLine($"  subscribers on the feed : {feed.Subscribers}");
        Collect();
        Console.WriteLine($"  widgets still alive     : {refs.FindAll(r => r.IsAlive).Count} of 5");
        Console.WriteLine($"  retained memory         : about {refs.FindAll(r => r.IsAlive).Count * 2} MB");
        Console.WriteLine("  Nothing in the program references those widgets. The feed does.");

        Console.WriteLine();
        Console.WriteLine("--- 2. the same widgets, unsubscribing ---");
        var feed2 = new MarketFeed();
        var refs2 = new List<WeakReference>();
        for (int i = 0; i < 5; i++)
        {
            var w = new PriceWidget(feed2);
            refs2.Add(new WeakReference(w));
            w.Dispose();
        }
        Console.WriteLine($"  subscribers on the feed : {feed2.Subscribers}");
        Collect();
        Console.WriteLine($"  widgets still alive     : {refs2.FindAll(r => r.IsAlive).Count} of 5");

        Console.WriteLine();
        Console.WriteLine("--- 3. dead subscribers still RUN ---");
        var feed3 = new MarketFeed();
        int handled = 0;
        for (int i = 0; i < 3; i++)
        {
            var w = new CountingWidget(feed3, () => handled++);
        }
        Collect();
        feed3.Publish(101.5m);
        Console.WriteLine($"  widgets created and dropped : 3");
        Console.WriteLine($"  handlers that ran on publish: {handled}");
        Console.WriteLine("  They are unreachable by the program and still doing work on every");
        Console.WriteLine("  event. The cost is CPU as well as memory.");

        Console.WriteLine();
        Console.WriteLine("--- 4. a lambda subscription cannot be removed ---");
        var feed4 = new MarketFeed();
        feed4.PriceChanged += p => { };
        Console.WriteLine($"  after subscribing a lambda : {feed4.Subscribers}");
        feed4.PriceChanged -= p => { };
        Console.WriteLine($"  after -= an identical one  : {feed4.Subscribers}");

        Action<decimal> kept = p => { };
        feed4.PriceChanged += kept;
        feed4.PriceChanged -= kept;
        Console.WriteLine($"  after += and -= a KEPT one : {feed4.Subscribers}");
        Console.WriteLine("  The lambda is still there and can never be removed.");
    }

    static void Collect()
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
    }
}

public sealed class CountingWidget
{
    private readonly Action _onEvent;
    public CountingWidget(MarketFeed feed, Action onEvent)
    {
        _onEvent = onEvent;
        feed.PriceChanged += Handle;
    }
    private void Handle(decimal p) => _onEvent();
}
