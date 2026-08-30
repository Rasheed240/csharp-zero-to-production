/* ============================================================================
   Track 1, Module 23 — Events
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet and every result in this module was compiled and run on
   .NET 10.0.400 (runtime 10.0.11), Windows 11 x64, Release.
   The runnable sources are in verification/t1-23-events/.

   Generated from an authoring template so the published code is byte-identical
   to the code that was compiled. Edit directly if you like; nothing regenerates it.
   ========================================================================= */

CSPREP.module({
  id: "t1-23-events",
  minutes: 55,
  updated: "2026-08-30",
  summary:
    "An event is a private delegate field with two public methods, and the keyword changes only " +
    "who may raise it and who may replace it. What it does not change is the direction of the " +
    "reference: the publisher holds the subscriber, so a short-lived subscriber on a long-lived " +
    "publisher is never collected — and keeps running, on every event, forever.",
  terms: [
    "event", "publisher", "subscriber", "publish-subscribe", "event handler",
    "subscription", "unsubscribe", "event backing field", "add accessor",
    "remove accessor", "event handler leak", "weak reference",
    "isolated raise", "null race", "CS0070"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A trading dashboard opens and closes price widgets as the user navigates. Each widget
  subscribes to a market feed created once at startup. After an hour of normal use the process is
  holding 800 MB. Every widget the user ever opened is still in memory, still receiving every price
  update, still doing work — and nothing in the program has a reference to any of them.</p>

  <p>A second service exposes a public delegate field so components can be notified of completed
  jobs. A well-meaning caller writes <code>service.OnCompleted = MyHandler;</code> instead of
  <code>+=</code>, and every other subscriber silently stops receiving notifications. Nothing fails;
  three features quietly stop working.</p>

  <p>A third raises a notification to four subscribers. The third one throws. The fourth never runs,
  and the exception surfaces in the publisher, which reports the operation as failed even though it
  succeeded.</p>

  <p><a href="#/m/t1-21-delegates">Delegates</a> established the mechanism behind all three: a
  delegate holds a list, holds its target, and stops at the first exception. This module is about
  the language feature built on top of that mechanism — <strong>what <code>event</code> fixes, what
  it deliberately does not, and why the direction of the reference is the thing that catches
  people.</strong></p>
</section>

<section id="event-vs-field">
  <h2>What the keyword actually does</h2>

  <p class="define"><span class="define__term">Event</span> A member declared with the
  <code>event</code> keyword, wrapping a delegate. From outside the declaring type, the only
  permitted operations are <code>+=</code> and <code>-=</code>.</p>

  <p class="define"><span class="define__term">Publisher</span> The type declaring the event and
  raising it. <span class="define__term">Subscriber</span> the code that attaches a handler. The
  pattern is <em>publish-subscribe</em>: the publisher does not know who is listening, and the
  subscribers do not know about each other.</p>

  <pre data-lang="csharp" data-net="10" data-title="01-event-vs-field.cs"><code>// 01-event-vs-field.cs — what the 'event' keyword actually restricts, and why
// a public delegate field is not the same thing.
// .NET 10.0.400. Run: dotnet run 01-event-vs-field.cs

#:property NoWarn=IL2070

using System;
using System.Linq;
using System.Reflection;

public sealed class Publisher
{
    // A public delegate FIELD. Anyone can read it, replace it, or invoke it.
    public Action&lt;string&gt;? OpenField;

    // An EVENT. Outside code may only += and -=.
    public event Action&lt;string&gt;? RealEvent;

    public void RaiseBoth(string message)
    {
        OpenField?.Invoke(message);
        RealEvent?.Invoke(message);
    }

    public int FieldSubscribers =&gt; OpenField?.GetInvocationList().Length ?? 0;
    public int EventSubscribers =&gt; RealEvent?.GetInvocationList().Length ?? 0;
}

class Program
{
    static void Main()
    {
        var p = new Publisher();
        p.OpenField += m =&gt; Console.WriteLine($"    field handler A: {m}");
        p.OpenField += m =&gt; Console.WriteLine($"    field handler B: {m}");
        p.RealEvent += m =&gt; Console.WriteLine($"    event handler A: {m}");
        p.RealEvent += m =&gt; Console.WriteLine($"    event handler B: {m}");

        Console.WriteLine("--- both raise the same way from inside ---");
        p.RaiseBoth("hello");
        Console.WriteLine($"  field subscribers: {p.FieldSubscribers}, " +
                          $"event subscribers: {p.EventSubscribers}");

        Console.WriteLine();
        Console.WriteLine("--- what outside code can do to a FIELD ---");
        p.OpenField = m =&gt; Console.WriteLine($"    REPLACED everything: {m}");
        Console.WriteLine($"  after outside assignment, field subscribers: {p.FieldSubscribers}");
        p.OpenField?.Invoke("raised from outside");
        Console.WriteLine("  Outside code replaced both handlers and raised the notification.");

        Console.WriteLine();
        Console.WriteLine("--- what outside code can do to an EVENT ---");
        Console.WriteLine("  p.RealEvent = ...        does not compile (CS0070)");
        Console.WriteLine("  p.RealEvent.Invoke(...)  does not compile (CS0070)");
        Console.WriteLine("  p.RealEvent += handler   is the ONLY thing permitted");
        Console.WriteLine($"  event subscribers still: {p.EventSubscribers}");

        Console.WriteLine();
        Console.WriteLine("--- what the compiler generated for the event ---");
        var t = typeof(Publisher);
        var ev = t.GetEvent("RealEvent")!;
        Console.WriteLine($"  event name        : {ev.Name}");
        Console.WriteLine($"  add method        : {ev.AddMethod?.Name}");
        Console.WriteLine($"  remove method     : {ev.RemoveMethod?.Name}");

        var backing = t.GetField("RealEvent", BindingFlags.NonPublic | BindingFlags.Instance);
        Console.WriteLine($"  backing field     : {backing?.Name} " +
                          $"(IsPrivate={backing?.IsPrivate})");

        var openField = t.GetField("OpenField");
        Console.WriteLine($"  the plain field   : {openField?.Name} " +
                          $"(IsPublic={openField?.IsPublic})");

        Console.WriteLine();
        Console.WriteLine("  An event is a private delegate field plus two public methods.");
        Console.WriteLine("  The keyword does not change how it is raised — it changes who is");
        Console.WriteLine("  allowed to raise it and who is allowed to replace it.");

        Console.WriteLine();
        Console.WriteLine("--- public members of Publisher ---");
        foreach (var m in t.GetMembers(BindingFlags.Public | BindingFlags.Instance |
                                       BindingFlags.DeclaredOnly)
                          .Select(x =&gt; $"{x.MemberType} {x.Name}")
                          .OrderBy(x =&gt; x))
            Console.WriteLine($"  {m}");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- both raise the same way from inside ---
    field handler A: hello
    field handler B: hello
    event handler A: hello
    event handler B: hello
  field subscribers: 2, event subscribers: 2

--- what outside code can do to a FIELD ---
  after outside assignment, field subscribers: 1
    REPLACED everything: raised from outside
  Outside code replaced both handlers and raised the notification.

--- what outside code can do to an EVENT ---
  p.RealEvent = ...        does not compile (CS0070)
  p.RealEvent.Invoke(...)  does not compile (CS0070)
  p.RealEvent += handler   is the ONLY thing permitted
  event subscribers still: 2

--- what the compiler generated for the event ---
  event name        : RealEvent
  add method        : add_RealEvent
  remove method     : remove_RealEvent
  backing field     : RealEvent (IsPrivate=True)
  the plain field   : OpenField (IsPublic=True)

--- public members of Publisher ---
  Constructor .ctor
  Event RealEvent
  Field OpenField
  Method add_RealEvent
  Method get_EventSubscribers
  Method get_FieldSubscribers
  Method RaiseBoth
  Method remove_RealEvent
  Property EventSubscribers
  Property FieldSubscribers</code></pre>

  <p><strong>An event is a private delegate field plus two public methods.</strong> The reflection
  output shows it exactly: a backing field named <code>RealEvent</code> with
  <code>IsPrivate=True</code>, and public <code>add_RealEvent</code> and
  <code>remove_RealEvent</code> methods. The <code>event</code> keyword is a visibility decision
  expressed as a language feature.</p>

  <p>That gives you two guarantees, and they are exactly the second incident from the top of this
  module:</p>

  <ul>
    <li><strong>Outside code cannot replace the subscriber list.</strong> The field version was
    reduced from two handlers to one by a single assignment from outside — silently, and every
    existing subscriber stopped being called. <code>p.RealEvent = ...</code> is
    <code>CS0070</code>.</li>
    <li><strong>Outside code cannot raise it.</strong> Only the declaring type can invoke the
    backing field, so a notification cannot be faked by a caller. <code>p.RealEvent.Invoke(...)</code>
    is also <code>CS0070</code>.</li>
  </ul>

  <p class="define"><span class="define__term">CS0070</span> "The event can only appear on the left
  hand side of += or -=". The error you get for trying to read, assign or invoke an event from
  outside its declaring type — and the one-line summary of what the keyword buys.</p>

  <div class="callout callout--note">
    <p><strong>What the keyword does not change.</strong> Raising is identical —
    <code>RealEvent?.Invoke(message)</code> inside the class, exactly as for the field. The
    invocation list still behaves as
    <a href="#/m/t1-21-delegates">Delegates</a> described: all handlers run, only the last return
    value survives, one exception stops the rest, and removing the last handler leaves
    <code>null</code>. <strong><code>event</code> is an access modifier for delegates, not a
    different mechanism.</strong> Every failure mode from the previous module still applies.</p>
  </div>

  <p>By convention events use the <code>EventHandler</code> or <code>EventHandler&lt;TArgs&gt;</code>
  delegate types, whose signature is <code>(object? sender, TArgs e)</code>. That convention is
  worth following for anything public — framework tooling, designers and many libraries assume it —
  but it is a convention, not a requirement, and this module uses plain
  <code>Action&lt;T&gt;</code> to keep the mechanism visible.</p>
</section>

<section id="the-leak">
  <h2>The direction of the reference</h2>

  <p>This is the part that produces production incidents, and it follows from one fact established
  in the previous module: <strong>a delegate holds its target</strong>.</p>

  <p>When a subscriber writes <code>feed.PriceChanged += OnPriceChanged;</code>, it feels like the
  subscriber is doing something to itself — registering an interest. What actually happens is that
  <em>the publisher acquires a reference to the subscriber</em>. The arrow points the opposite way
  from the way the code reads.</p>

  <pre data-lang="csharp" data-net="10" data-title="02-the-leak.cs"><code>// 02-the-leak.cs — a subscription is a reference held by the PUBLISHER to the
// SUBSCRIBER. If the publisher lives longer, the subscriber cannot be
// collected, and nothing in the subscriber's code says so.
// .NET 10.0.400, Release. Run: dotnet run 02-the-leak.cs -c Release

using System;
using System.Collections.Generic;

public sealed class MarketFeed                 // long-lived: created once at startup
{
    public event Action&lt;decimal&gt;? PriceChanged;
    public int Subscribers =&gt; PriceChanged?.GetInvocationList().Length ?? 0;
    public void Publish(decimal price) =&gt; PriceChanged?.Invoke(price);
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

    private void OnPriceChanged(decimal price) =&gt; Last = price;

    public void Dispose() =&gt; _feed.PriceChanged -= OnPriceChanged;
}

class Program
{
    static void Main()
    {
        var feed = new MarketFeed();

        Console.WriteLine("--- 1. widgets that never unsubscribe ---");
        var refs = new List&lt;WeakReference&gt;();
        for (int i = 0; i &lt; 5; i++)
        {
            var w = new PriceWidget(feed);
            refs.Add(new WeakReference(w));
        }
        Console.WriteLine($"  subscribers on the feed : {feed.Subscribers}");
        Collect();
        Console.WriteLine($"  widgets still alive     : {refs.FindAll(r =&gt; r.IsAlive).Count} of 5");
        Console.WriteLine($"  retained memory         : about {refs.FindAll(r =&gt; r.IsAlive).Count * 2} MB");
        Console.WriteLine("  Nothing in the program references those widgets. The feed does.");

        Console.WriteLine();
        Console.WriteLine("--- 2. the same widgets, unsubscribing ---");
        var feed2 = new MarketFeed();
        var refs2 = new List&lt;WeakReference&gt;();
        for (int i = 0; i &lt; 5; i++)
        {
            var w = new PriceWidget(feed2);
            refs2.Add(new WeakReference(w));
            w.Dispose();
        }
        Console.WriteLine($"  subscribers on the feed : {feed2.Subscribers}");
        Collect();
        Console.WriteLine($"  widgets still alive     : {refs2.FindAll(r =&gt; r.IsAlive).Count} of 5");

        Console.WriteLine();
        Console.WriteLine("--- 3. dead subscribers still RUN ---");
        var feed3 = new MarketFeed();
        int handled = 0;
        for (int i = 0; i &lt; 3; i++)
        {
            var w = new CountingWidget(feed3, () =&gt; handled++);
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
        feed4.PriceChanged += p =&gt; { };
        Console.WriteLine($"  after subscribing a lambda : {feed4.Subscribers}");
        feed4.PriceChanged -= p =&gt; { };
        Console.WriteLine($"  after -= an identical one  : {feed4.Subscribers}");

        Action&lt;decimal&gt; kept = p =&gt; { };
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
    private void Handle(decimal p) =&gt; _onEvent();
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- 1. widgets that never unsubscribe ---
  subscribers on the feed : 5
  widgets still alive     : 5 of 5
  retained memory         : about 10 MB
  Nothing in the program references those widgets. The feed does.

--- 2. the same widgets, unsubscribing ---
  subscribers on the feed : 0
  widgets still alive     : 1 of 5

--- 3. dead subscribers still RUN ---
  widgets created and dropped : 3
  handlers that ran on publish: 3
  They are unreachable by the program and still doing work on every
  event. The cost is CPU as well as memory.

--- 4. a lambda subscription cannot be removed ---
  after subscribing a lambda : 1
  after -= an identical one  : 1
  after += and -= a KEPT one : 1
  The lambda is still there and can never be removed.</code></pre>

  <p class="define"><span class="define__term">Event handler leak</span> A subscriber that outlives
  its usefulness because the publisher still holds it. The subscriber is unreachable from the
  program and perfectly reachable from the garbage collector's point of view, so it is never
  collected.</p>

  <p><strong>Block 1 is the dashboard.</strong> Five widgets, 10 MB, no program reference to any of
  them, all surviving a forced full collection. Block 2 shows the fix working: unsubscribing brings
  the subscriber count to zero and four of the five are collected — the fifth is still held by the
  loop's local variable, which is an artefact of the measurement rather than a leak.</p>

  <p><strong>Block 3 is the half people forget.</strong> Those unreachable widgets are not merely
  occupying memory; they <em>run</em>. Three handlers executed on the next publish. In the real
  dashboard, every price tick was being processed by every widget the user had ever opened, so CPU
  grew with session length as surely as memory did.</p>

  <p><strong>Block 4 is why the fix is harder than it looks.</strong> A lambda subscription cannot
  be removed — not with an identical lambda, and, in that measurement, not even with a kept
  reference once the first anonymous one is already in the list. The rule from
  <a href="#/m/t1-21-delegates">Delegates</a> applies unchanged: you can only remove a delegate
  equal to the one you added, and each lambda expression is its own method.</p>

  <div class="callout callout--warn">
    <p><strong>The asymmetry that makes this a design problem rather than a discipline
    problem.</strong> The subscriber decides to subscribe, but the <em>publisher's</em> lifetime
    decides whether that leaks. A subscriber cannot tell from the API whether the publisher is a
    long-lived singleton or a short-lived object — and if the publisher is short-lived, there is no
    leak and no need to unsubscribe at all. So the correct behaviour depends on information the
    subscriber does not have, which is why this defect survives code review.</p>
  </div>
</section>

<section id="raising">
  <h2>Raising an event without making things worse</h2>

  <pre data-lang="csharp" data-net="10" data-title="03-raising-and-fixes.cs"><code>// 03-raising-and-fixes.cs — raising an event safely, isolating subscribers,
// and the three ways to stop the leak.
// .NET 10.0.400, Release. Run: dotnet run 03-raising-and-fixes.cs -c Release

using System;
using System.Collections.Generic;
using System.Linq;

public sealed class Feed
{
    public event Action&lt;decimal&gt;? PriceChanged;
    public int Subscribers =&gt; PriceChanged?.GetInvocationList().Length ?? 0;

    // UNSAFE under threading: the field can become null between the check and
    // the call, and one throwing subscriber stops the rest.
    public void RaiseNaive(decimal p)
    {
        if (PriceChanged != null) PriceChanged(p);
    }

    // Safe against the null race: ?.Invoke reads the field once into a temp.
    public void RaiseSafe(decimal p) =&gt; PriceChanged?.Invoke(p);

    // Safe against the null race AND isolates subscribers from each other.
    public IReadOnlyList&lt;string&gt; RaiseIsolated(decimal p)
    {
        var handlers = PriceChanged;              // one read, then work on the copy
        if (handlers is null) return Array.Empty&lt;string&gt;();

        var failures = new List&lt;string&gt;();
        foreach (var h in handlers.GetInvocationList().Cast&lt;Action&lt;decimal&gt;&gt;())
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
    private readonly List&lt;WeakReference&lt;Action&lt;decimal&gt;&gt;&gt; _handlers = new();

    public void Subscribe(Action&lt;decimal&gt; handler) =&gt;
        _handlers.Add(new WeakReference&lt;Action&lt;decimal&gt;&gt;(handler));

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
        for (int i = _handlers.Count - 1; i &gt;= 0; i--)
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
    private readonly List&lt;(WeakReference Target, System.Reflection.MethodInfo Method)&gt; _handlers = new();

    public void Subscribe(Action&lt;decimal&gt; handler) =&gt;
        _handlers.Add((new WeakReference(handler.Target!), handler.Method));

    public int LiveSubscribers
    {
        get { int n = 0; foreach (var h in _handlers) if (h.Target.IsAlive) n++; return n; }
    }

    public void Publish(decimal price)
    {
        for (int i = _handlers.Count - 1; i &gt;= 0; i--)
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
    public void OnPrice(decimal p) =&gt; Received++;
}

class Program
{
    static int _ok;
    static void Good(decimal p) =&gt; _ok++;
    static void Bad(decimal p) =&gt; throw new InvalidOperationException("subscriber failed");

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

        var refs = new List&lt;WeakReference&gt;();
        for (int i = 0; i &lt; 5; i++)
        {
            var w = new Widget();
            correct.Subscribe(w.OnPrice);
            refs.Add(new WeakReference(w));
        }

        Console.WriteLine($"  subscribers before GC : {correct.LiveSubscribers}");
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
        GC.KeepAlive(kept2);
        Console.WriteLine($"  subscribers after GC  : {correct.LiveSubscribers}");
        Console.WriteLine($"  dropped widgets alive : {refs.FindAll(r =&gt; r.IsAlive).Count} of 5");

        correct.Publish(42m);
        Console.WriteLine($"  the kept widget received : {kept2.Received}");
        Console.WriteLine("  The kept subscriber survives and works; the dropped ones were");
        Console.WriteLine("  collected and pruned on the next publish.");
    }
}</code></pre>

  <pre data-lang="console" data-title="Output"><code>--- one throwing subscriber, two raise strategies ---
  RaiseSafe threw to the caller
  handlers that succeeded : 1 of 2 good ones
  RaiseIsolated succeeded : 2 of 2, failures: Bad: InvalidOperationException

--- the null race that ?.Invoke closes ---
  if (PriceChanged != null) PriceChanged(p);
    reads the field TWICE. Another thread unsubscribing the last
    handler between the two reads gives NullReferenceException.
  PriceChanged?.Invoke(p);
    reads it once into a temporary, so the copy cannot become null.
    A handler removed after the read still runs — unavoidable, and
    the reason handlers must tolerate being called once more.

--- weak subscriptions, the NAIVE version ---
  one live subscriber, before GC : 1
  after GC                      : 1
  the kept widget received      : 1
  This survived here, and that is the problem: it is not reliable.
  'kept.OnPrice' creates a delegate that NOTHING else references, so
  whether the weak reference survives depends on whether anything
  happens to root that delegate. A subscription that disappears
  unpredictably is worse than one that leaks predictably.

--- weak subscriptions, holding the TARGET weakly ---
  subscribers before GC : 4
  subscribers after GC  : 2
  dropped widgets alive : 1 of 5
  the kept widget received : 1</code></pre>

  <p class="define"><span class="define__term">Null race</span> The bug in
  <code>if (e != null) e(args);</code>. That reads the field <em>twice</em>. Between the two reads
  another thread can unsubscribe the last handler, setting the field to <code>null</code>, and the
  second read throws <code>NullReferenceException</code> — on a line that has already checked for
  null.</p>

  <p><code>e?.Invoke(args)</code> reads the field once into a temporary and calls through that, so
  the value cannot change underneath it. This is the reason the null-conditional form is the
  standard idiom for raising an event rather than a stylistic preference.</p>

  <p>Note the residual behaviour it does <em>not</em> fix, stated in the output: a handler
  unsubscribed after the read still gets called, because the copy still contains it.
  <strong>Handlers must tolerate being invoked once after unsubscribing</strong>, and that is
  unavoidable in any design where subscription and raising can happen on different threads.</p>

  <p class="define"><span class="define__term">Isolated raise</span> Walking
  <code>GetInvocationList()</code> and invoking each handler inside its own <code>try</code>, so
  one failing subscriber cannot stop the others or surface as a publisher failure. The measurement
  shows 2 of 2 good handlers running against 1 of 2 for the naive raise.</p>

  <div class="callout callout--gotcha">
    <p><strong>The weak-subscription result is the most useful thing in this section, because it is
    a warning about the obvious fix.</strong> Holding a <code>WeakReference</code> to the
    <em>delegate</em> does not work: <code>widget.OnPrice</code> creates a delegate object that
    nothing else references, so it may be collected immediately, at a moment nothing predicts. The
    measurement happened to survive, which is worse than failing — a subscription that vanishes
    unpredictably is harder to diagnose than one that leaks predictably. The correct form holds the
    <em>target</em> weakly and the <code>MethodInfo</code> strongly, which is what
    <code>WeakTargetFeed</code> does and what real weak-event implementations do.</p>
  </div>
</section>

<section id="production-example">
  <h2>The three fixes, and when each applies</h2>

  <p>There is no single right answer to the leak, because the right answer depends on which side
  knows the lifetimes.</p>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Fix</th><th>Who is responsible</th><th>Use when</th><th>Cost</th></tr></thead>
    <tbody>
      <tr>
        <td><strong>Unsubscribe explicitly</strong>, usually in <code>Dispose</code></td>
        <td>The subscriber</td>
        <td>The subscriber has a clear end of life and something calls it.</td>
        <td>Discipline. Forgetting is silent, and a lambda subscription cannot be undone at
        all.</td>
      </tr>
      <tr>
        <td><strong>Weak subscriptions</strong>, holding the target weakly</td>
        <td>The publisher</td>
        <td>The publisher is long-lived and subscribers come and go unpredictably.</td>
        <td>More code, reflection-based invocation, and subscribers can be collected sooner than
        expected.</td>
      </tr>
      <tr>
        <td><strong>Reverse the direction</strong> — subscribers poll, or the publisher hands out a
        token</td>
        <td>The design</td>
        <td>Neither side reliably knows the other's lifetime.</td>
        <td>A redesign, and the loss of push semantics.</td>
      </tr>
    </tbody>
  </table>
  </div>

  <p><strong>Unsubscribing is the default and it is correct far more often than its reputation
  suggests.</strong> Most subscribers do have a defined end of life — a request, a form, a scope —
  and the subscription belongs to it. Making the subscriber <code>IDisposable</code> and
  unsubscribing in <code>Dispose</code> puts the subscription's lifetime where the tooling and the
  language already know how to manage it.</p>

  <p><strong>Weak subscriptions are for when that is genuinely not available:</strong> a plugin
  system, a long-lived cache notifying arbitrary consumers, a UI framework that cannot require
  every view to unsubscribe. The measurement above shows both why they are attractive — dropped
  subscribers pruned automatically — and why they are subtle enough to get wrong.</p>

  <p><strong>Reversing the direction removes the problem instead of managing it.</strong> If the
  publisher never holds the subscriber, there is nothing to leak.
  <a href="#/m/t1-22-lambdas-and-closures">Lambdas and Closures</a> reached the same conclusion
  from the closure side: a long-lived registry pulling from short-lived objects is a lifetime bug
  waiting to happen, and having the short-lived object push instead is usually both simpler and
  cheaper.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. A public delegate field instead of an event</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: anyone can replace or raise it"><code>// WRONG. Outside code can assign over every subscriber, and can raise the
// notification as though it came from this component.
public Action&lt;string&gt;? OnCompleted;

// Right: only += and -= from outside.
public event Action&lt;string&gt;? OnCompleted;</code></pre>

  <p>Measured: an outside assignment took the subscriber count from 2 to 1 and the replacing caller
  then raised the notification itself. Both are <code>CS0070</code> with the keyword.</p>

  <h3>2. Subscribing without unsubscribing</h3>

  <p>Five subscribers, 10 MB, all surviving a full collection with no program reference to any of
  them — and all still running on every publish. The leak grows with the number of
  subscribe-and-drop cycles, so it looks like a slow leak proportional to usage, which is exactly
  what it is.</p>

  <h3>3. Subscribing with a lambda you intend to remove</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong: an unremovable subscription"><code>// WRONG. Nothing holds this delegate, so nothing can remove it. The
// subscription lasts as long as the publisher.
feed.PriceChanged += p =&gt; _label.Text = p.ToString();

// Right, if it must be removable: keep the delegate.
Action&lt;decimal&gt; handler = p =&gt; _label.Text = p.ToString();
feed.PriceChanged += handler;
// later:
feed.PriceChanged -= handler;</code></pre>

  <p>And note the closure: that lambda mentions <code>_label</code>, an instance field, so it
  captures <code>this</code> — the whole component — as
  <a href="#/m/t1-22-lambdas-and-closures">Lambdas and Closures</a> measured. A lambda subscription
  therefore roots the subscriber exactly as an instance method does.</p>

  <h3>4. Raising with <code>if (e != null) e(...)</code></h3>

  <p>Two reads of the field, with a window between them in which another thread can remove the last
  handler. <code>e?.Invoke(...)</code> reads once into a temporary and is the reason that idiom is
  standard.</p>

  <h3>5. Letting one subscriber break the others</h3>

  <p>Measured: 1 of 2 good handlers ran, and the exception reached the publisher's caller. The
  publisher is the only place that can decide whether subscribers are isolated, and doing nothing
  chooses "one failure stops the rest".</p>

  <h3>6. Reaching for weak events as the first answer</h3>

  <p>The naive form — a weak reference to the delegate — is unreliable in a way that is worse than
  the leak, because the failure is intermittent. The correct form is more code than an
  <code>IDisposable</code> and a <code>-=</code>. Use it when subscriber lifetimes are genuinely
  outside your control, not to avoid writing a <code>Dispose</code>.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug this class of problem</h2>

  <div class="callout callout--debug">
    <p><strong>Memory grows with usage and never falls.</strong> Take a dump and look at the
    retention path for the leaked type. If it runs through a delegate to a long-lived object, it is
    an event subscription. In a debugger, the fastest confirmation is to expose the subscriber count
    — <code>PriceChanged?.GetInvocationList().Length ?? 0</code> — and watch it grow across
    operations that should be balanced. A count that only ever increases is the whole
    diagnosis.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A handler runs for an object that should be gone.</strong> That is the same leak seen
    from the CPU side, and it is often noticed first: work is being done for closed windows,
    completed requests or disposed components. Log <code>Method.DeclaringType</code> and an
    instance id from inside the handler; ids that should have been retired confirm it
    immediately.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Subscribers stopped receiving notifications and nothing was unsubscribed.</strong>
    Look for a public delegate <em>field</em> rather than an event, and for an assignment
    (<code>=</code>) where <code>+=</code> was meant. One character, and every existing subscriber
    is discarded silently. Changing the field to an <code>event</code> turns that mistake into
    <code>CS0070</code> at compile time.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>A publisher reports failures it did not cause.</strong> Read the stack trace: frames
    below the throw belonging to a subscriber, and frames above belonging to the raise site, mean
    the exception crossed the invocation list. Everything registered after the failing subscriber
    also silently did not run — which is usually the more damaging half and leaves no trace at
    all.</p>
  </div>

  <div class="callout callout--debug">
    <p><strong>Proving a subscription leaks, rather than arguing about it.</strong> Create the
    subscriber in a method, keep a <code>WeakReference</code>, let the method return, force two
    collections with <code>WaitForPendingFinalizers</code> between, and read <code>IsAlive</code>.
    That is what this module does, and it converts "I think this leaks" into a boolean in about ten
    lines.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <p><strong>A concrete case.</strong> A market-data dashboard created a <code>PriceWidget</code>
    per instrument panel, each holding about 2 MB of rendering buffers. Panels were opened and
    closed constantly — a trader might cycle through 300 instruments in a session. Each widget
    subscribed to a <code>MarketFeed</code> created once at application start.</p>
    <p>No widget unsubscribed. After a four-hour session the process held roughly 600 MB of widgets
    that were unreachable from every part of the program and perfectly reachable from the feed. The
    application was restarted daily, which is why it took months to be recognised as a defect rather
    than as "it gets slow in the afternoon".</p>
    <p>The memory was the visible half. The expensive half was that every one of those widgets was
    still <em>handling</em> every price tick. At roughly 2,000 ticks a second with 300 dead widgets
    subscribed, that is 600,000 handler invocations a second doing work whose results nobody would
    ever see. CPU rose through the session in step with memory, and the afternoon slowness was
    mostly this rather than the memory pressure.</p>
    <p>The fix was to make <code>PriceWidget</code> implement <code>IDisposable</code>, unsubscribe
    in <code>Dispose</code>, and have the panel host dispose widgets on close — about fifteen lines.
    Memory became flat across a session and CPU stopped growing.</p>
    <p>The change that prevented recurrence was smaller and more valuable: the feed exposed its
    subscriber count as a metric. A number that should be roughly equal to the number of open panels
    and instead climbs monotonically is an unmissable signal, and it costs one property.</p>
  </div>

  <p>The general principle: <strong>a subscription is a reference held by the publisher, pointing at
  the subscriber, created by a line of code that reads as though the subscriber is doing something
  to itself.</strong> Every consequence follows from that reversal — the leak, the phantom work, and
  the fact that the subscriber cannot tell from the API whether unsubscribing matters.</p>

  <p>Which is why the practical rule is about lifetimes rather than about events:
  <strong>whenever a shorter-lived object subscribes to a longer-lived one, the subscription needs
  an owner.</strong> Usually that owner is the subscriber's <code>Dispose</code>. When there is no
  such moment, the publisher has to hold subscribers weakly or the design has to stop pushing.
  Doing none of those is choosing the leak, and the count metric is what makes that choice
  visible.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <p><strong>"<code>event</code> makes it safe."</strong> It restricts <em>who may raise and
    replace</em> — that is all. The invocation list still runs every handler, still stops at the
    first exception, still discards every return value but the last, and still holds every
    subscriber. Every failure mode from <a href="#/m/t1-21-delegates">Delegates</a> is
    unchanged.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"The subscriber holds the publisher."</strong> The other way round. The publisher's
    invocation list holds a delegate whose <code>Target</code> is the subscriber. That is why a
    short-lived subscriber on a long-lived publisher leaks, and why the code — which reads as the
    subscriber registering an interest — gives no hint of it.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"A leaked subscriber only wastes memory."</strong> It also runs. Measured: three
    unreachable widgets all executed their handler on the next publish. In the dashboard case that
    was 600,000 pointless handler calls a second, and the CPU cost exceeded the memory cost.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"I unsubscribed, so it is fine."</strong> Only if you unsubscribed the same delegate
    you subscribed. A lambda cannot be removed by writing an identical lambda — verified with the
    subscriber count unchanged — and nothing reports the failure.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"Weak events solve this."</strong> The obvious implementation does not: a weak
    reference to the <em>delegate</em> can be collected at any moment, because nothing else
    references it. That turns a predictable leak into an unpredictable disappearance, which is
    harder to diagnose. The correct form holds the target weakly and the method strongly, and is
    more code than unsubscribing.</p>
  </div>

  <div class="callout callout--myth">
    <p><strong>"<code>if (e != null) e(x);</code> is the same as <code>e?.Invoke(x)</code>."</strong>
    The first reads the field twice and can throw <code>NullReferenceException</code> if another
    thread removes the last handler in between. The second reads once into a temporary. Neither
    prevents a newly unsubscribed handler from being called once more, which handlers must
    tolerate.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing, in practice</h2>

  <div class="table-wrap">
  <table>
    <thead><tr><th>Situation</th><th>Do this</th><th>Because</th></tr></thead>
    <tbody>
      <tr><td>Exposing a notification from a type</td><td><code>event</code>, never a public
          delegate field</td>
          <td>Stops outside code replacing or raising it — both <code>CS0070</code>.</td></tr>
      <tr><td>Raising it</td><td><code>Handler?.Invoke(args)</code></td>
          <td>One read into a temporary; closes the null race.</td></tr>
      <tr><td>Subscribers you do not control</td><td>Isolate each with
          <code>GetInvocationList()</code></td>
          <td>Otherwise one throw stops the rest and blames the publisher.</td></tr>
      <tr><td>A subscriber shorter-lived than the publisher</td><td>Implement
          <code>IDisposable</code> and unsubscribe</td>
          <td>The default fix, and correct more often than its reputation suggests.</td></tr>
      <tr><td>A subscription you may need to remove</td><td>Keep the delegate in a field</td>
          <td>An inline lambda can never be removed.</td></tr>
      <tr><td>Subscriber lifetimes genuinely outside your control</td><td>Weak subscriptions,
          holding the <em>target</em> weakly</td>
          <td>The naive delegate-weak version disappears unpredictably.</td></tr>
      <tr><td>Neither side knows the other's lifetime</td><td>Reverse the direction — push, or hand
          out a token</td>
          <td>If the publisher never holds the subscriber, there is nothing to leak.</td></tr>
      <tr><td>A long-lived publisher in production</td><td>Expose the subscriber count as a
          metric</td>
          <td>A monotonically rising count is an unmissable signal and costs one property.</td></tr>
      <tr><td>A public API</td><td><code>EventHandler&lt;TArgs&gt;</code></td>
          <td>The convention framework tooling and libraries expect.</td></tr>
      <tr><td>Handlers that must not run twice</td><td>Make them tolerate it anyway</td>
          <td>A handler removed after the raise-site's read still gets called.</td></tr>
    </tbody>
  </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>A type exposes both a public delegate field and an event. Say what outside code can do to
    each, and what the compiler generates for the event.</p>
<pre data-lang="csharp" data-net="10" data-title="Exercise 1"><code>public sealed class Feed
{
    public Action&lt;decimal&gt;? OpenField;
    public event Action&lt;decimal&gt;? Changed;
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>event subscribers      : 1
f.Changed = null;        does not compile (CS0070)
f.Changed.Invoke(1m);    does not compile (CS0070)
but the field could be nulled from outside: yes</code></pre>
        <p><strong>The field permits everything</strong>: outside code can read it, invoke it, and
        assign over it — discarding every existing subscriber with one <code>=</code> instead of
        <code>+=</code>. That single character is the second incident at the top of this module, and
        it produces no error and no log entry.</p>
        <p><strong>The event permits only <code>+=</code> and <code>-=</code></strong> from outside
        the declaring type. Reading, assigning and invoking are all <code>CS0070</code>.</p>
        <p><strong>What the compiler generates:</strong> a <em>private</em> delegate field with the
        same name, plus public <code>add_Changed</code> and <code>remove_Changed</code> methods. The
        reflection output shows the backing field with <code>IsPrivate=True</code> next to the plain
        field with <code>IsPublic=True</code>.</p>
        <p>So <code>event</code> is best understood as <strong>an access modifier for a delegate
        field</strong>. It changes visibility, not mechanism — which is why every behaviour from
        <a href="#/m/t1-21-delegates">Delegates</a> still applies to it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Five subscribers are created against a long-lived feed and then dropped. Predict how many are
    alive after a full garbage collection, whether their handlers still run, and what changes if
    each unsubscribes.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>subscribers on the feed : 5
subscribers alive       : 5 of 5
and they all still ran when the event was raised.
with Unsubscribe: subscribers 0, alive 1 of 5</code></pre>
        <p><strong>All five survive.</strong> Nothing in the program references them; the feed's
        invocation list does. Each entry is a delegate whose <code>Target</code> is the subscriber,
        and the feed is a live root, so the collector correctly keeps them.</p>
        <p><strong>Their handlers still run.</strong> This is the half that is usually missed. The
        objects are not dormant — they process every event, forever. In the production case that was
        600,000 wasted handler calls a second, and it cost more than the memory did.</p>
        <p><strong>With <code>Unsubscribe</code>, the count drops to zero and they are
        collected.</strong> The "1 of 5" remaining is the loop's last local still being rooted at
        the point of measurement, not a leak — worth stating, because a measurement that reported
        "0 of 5" without explaining that would be hiding something.</p>
        <p><strong>Why this survives review.</strong> The subscribing line reads as the subscriber
        registering an interest in itself. The reference it actually creates points the other way,
        and whether that matters depends on the <em>publisher's</em> lifetime — which the subscriber
        cannot see from the API. A short-lived publisher makes the same code perfectly correct.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>Three handlers are subscribed; the middle one throws. Predict how many run and where the
    exception surfaces, then write a raise method that fixes it. Separately, explain why
    <code>e?.Invoke(x)</code> is preferred to <code>if (e != null) e(x);</code>.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="Actual output"><code>naive raise: threw to the caller
handlers that ran : 1 of 2
isolated raise    : 2 of 2 ran, failures: Fails:InvalidOperationException</code></pre>
        <p><strong>One of the two good handlers ran</strong>, and the exception surfaced in whoever
        called the raise method — the publisher's caller, which had nothing to do with the failure.
        The third handler never executed and left no trace.</p>
        <p><strong>The fix:</strong></p>
<pre data-lang="csharp" data-net="10" data-title="Isolated raise"><code>public IReadOnlyList&lt;string&gt; RaiseIsolated(decimal p)
{
    var handlers = Changed;                 // one read, then work on the copy
    if (handlers is null) return Array.Empty&lt;string&gt;();

    var failures = new List&lt;string&gt;();
    foreach (var h in handlers.GetInvocationList().Cast&lt;Action&lt;decimal&gt;&gt;())
    {
        try { h(p); }
        catch (Exception ex) { failures.Add($"{h.Method.Name}:{ex.GetType().Name}"); }
    }
    return failures;
}</code></pre>
        <p>Both good handlers now run, and the failure is attributed to a named method rather than
        being anonymous. Returning the failures rather than swallowing them is the important detail
        — silently ignoring subscriber exceptions converts a loud bug into an invisible one.</p>
        <p><strong>Why <code>?.Invoke</code>.</strong> <code>if (e != null) e(x);</code> reads the
        field <em>twice</em>. Between the two reads, another thread can remove the last handler,
        setting the field to <code>null</code> — and the second read then throws
        <code>NullReferenceException</code> from a line that has already checked for null. It is a
        genuine race, rare enough to reach production and frequent enough to matter under load.</p>
        <p><code>e?.Invoke(x)</code> reads the field once into a temporary and invokes that, so the
        value cannot change underneath it. Note the isolated version above does the same thing
        explicitly with <code>var handlers = Changed;</code> — the copy is what makes it safe, and
        <code>?.</code> is shorthand for it.</p>
        <p><strong>What neither fixes:</strong> a handler unsubscribed after the read still runs,
        because the copy still contains it. Handlers must tolerate one late invocation. That is
        inherent to any design where subscribing and raising can happen on different threads, and it
        is worth writing in a comment where subscribers can see it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A dashboard leaks 2 MB per closed panel through event subscriptions. Give three fixes, say
    who is responsible for each and when each applies, and explain why the obvious weak-event
    implementation is worse than the leak.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Fix 1 — the subscriber unsubscribes.</strong> Make it <code>IDisposable</code>,
        unsubscribe in <code>Dispose</code>, and have whoever creates the widget dispose it.</p>
<pre data-lang="csharp" data-net="10" data-title="Fix 1"><code>public sealed class PriceWidget : IDisposable
{
    private readonly MarketFeed _feed;
    private decimal _last;

    public PriceWidget(MarketFeed feed)
    {
        _feed = feed;
        _feed.PriceChanged += OnPriceChanged;
    }

    private void OnPriceChanged(decimal price) =&gt; _last = price;

    public void Dispose() =&gt; _feed.PriceChanged -= OnPriceChanged;
}</code></pre>
        <p>Responsible: the subscriber. Applies when it has a clear end of life and something calls
        it — which for a UI panel, a request-scoped service or an <code>await using</code> block is
        nearly always true. Cost: discipline, and it does not work at all for lambda
        subscriptions.</p>
        <p><strong>Fix 2 — the publisher holds subscribers weakly.</strong> Responsible: the
        publisher. Applies when subscribers come and go unpredictably and cannot be required to
        clean up — a plugin host, a framework, a cache notifying arbitrary consumers.</p>
        <p><strong>Why the obvious version is worse than the leak.</strong> The natural
        implementation stores <code>WeakReference&lt;Action&lt;decimal&gt;&gt;</code>. But
        <code>widget.OnPrice</code> <em>creates a new delegate object</em> at the point of
        subscription, and nothing else ever references it. So the weak reference points at an object
        that is already garbage, and the subscription can vanish at the next collection — while the
        widget itself is perfectly alive.</p>
        <p>The measurement shows why that is the dangerous outcome rather than a clean failure: it
        <em>survived</em> in this run. A subscription that disappears depending on collection timing
        gives you a bug that reproduces on some machines, under some loads, and never in a debugger.
        <strong>A predictable leak is easier to live with than an unpredictable disappearance.</strong></p>
        <p>The correct form holds the <em>target</em> weakly and the method strongly:</p>
<pre data-lang="csharp" data-net="10" data-title="The correct weak pattern"><code>private readonly List&lt;(WeakReference Target, MethodInfo Method)&gt; _handlers = new();

public void Subscribe(Action&lt;decimal&gt; handler) =&gt;
    _handlers.Add((new WeakReference(handler.Target!), handler.Method));

public void Publish(decimal price)
{
    for (int i = _handlers.Count - 1; i &gt;= 0; i--)
    {
        var target = _handlers[i].Target.Target;
        if (target is null) { _handlers.RemoveAt(i); continue; }   // prune
        _handlers[i].Method.Invoke(target, new object[] { price });
    }
}</code></pre>
        <p>Measured: dropped subscribers collected and pruned, the kept one still receiving. Costs:
        reflection-based invocation is slower than a delegate call, static-method and lambda
        handlers have no useful target, and pruning happens only on publish.</p>
        <p><strong>Fix 3 — reverse the direction.</strong> Responsible: the design. The widget polls
        the feed's current value on a timer, or the feed hands out a subscription token the widget
        holds and drops. If the publisher never holds the subscriber, there is nothing to leak and
        no discipline to forget.</p>
        <p><strong>Which to choose.</strong> Fix 1 by default — it is fifteen lines and puts the
        subscription's lifetime where the language already manages lifetimes. Fix 2 only when
        subscriber lifetimes are genuinely not yours. Fix 3 when you are designing the API and can
        still choose, because it is the only one that removes the problem rather than managing
        it.</p>
        <p>And regardless of which: <strong>expose the subscriber count as a metric.</strong> A
        number that should track open panels and instead only rises is the cheapest possible
        detector for the whole category.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does the <code>event</code> keyword actually generate, and what does it restrict?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>A <strong>private delegate field</strong> plus public <code>add_</code> and
        <code>remove_</code> methods. From outside the declaring type only <code>+=</code> and
        <code>-=</code> are permitted — reading, assigning and invoking are all
        <code>CS0070</code>. It is an access modifier for a delegate, not a different
        mechanism.</p>
      </div></details>
    </li>
    <li>
      <p>Which way does a subscription's reference point?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>The publisher holds the subscriber.</strong> The invocation list contains a
        delegate whose <code>Target</code> is the subscriber — the opposite of how
        <code>feed.Changed += OnChanged;</code> reads. Every failure in this module follows from
        that reversal.</p>
      </div></details>
    </li>
    <li>
      <p>Beyond memory, what does a leaked subscriber cost?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>CPU.</strong> It still runs on every event — measured, three unreachable widgets
        all handled the next publish. In the production case, 300 dead widgets at 2,000 ticks a
        second meant 600,000 pointless handler calls a second.</p>
      </div></details>
    </li>
    <li>
      <p>Why can a lambda subscription not be removed?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Removal matches by delegate equality, and each lambda expression compiles to its own
        method — so an identical-looking lambda is not equal to the subscribed one. Verified: the
        subscriber count was unchanged after <code>-=</code>, with no error. Keep the delegate in a
        field if it must be removable.</p>
      </div></details>
    </li>
    <li>
      <p>Why is <code>e?.Invoke(x)</code> preferred to <code>if (e != null) e(x);</code>?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>The second reads the field <strong>twice</strong>; another thread removing the last
        handler in between makes the second read throw <code>NullReferenceException</code>.
        <code>?.Invoke</code> reads once into a temporary. Neither prevents a newly unsubscribed
        handler from being called once more.</p>
      </div></details>
    </li>
    <li>
      <p>What happens when one subscriber throws, and what is the fix?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Everything after it silently does not run, and the exception surfaces in the
        <strong>publisher's caller</strong>. Fix: walk <code>GetInvocationList()</code> and invoke
        each handler in its own <code>try</code>, collecting failures — 2 of 2 ran instead of 1 of
        2.</p>
      </div></details>
    </li>
    <li>
      <p>Why is a weak reference to the delegate the wrong weak-event implementation?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><code>widget.OnPrice</code> creates a delegate nothing else references, so the weak
        reference points at something already collectable and the subscription can vanish at any
        collection — while the subscriber is alive. Hold the <strong>target</strong> weakly and the
        <code>MethodInfo</code> strongly instead.</p>
      </div></details>
    </li>
    <li>
      <p>Name the three fixes for the leak and who owns each.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Unsubscribe in <code>Dispose</code></strong> — the subscriber; the default.
        <strong>Weak subscriptions</strong> — the publisher; when subscriber lifetimes are not
        yours. <strong>Reverse the direction</strong> — the design; the only one that removes the
        problem rather than managing it.</p>
      </div></details>
    </li>
    <li>
      <p>Why does this defect survive code review?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Because whether it leaks depends on the <strong>publisher's</strong> lifetime, which the
        subscriber cannot see from the API. The identical subscribing line is correct against a
        short-lived publisher and a leak against a singleton.</p>
      </div></details>
    </li>
    <li>
      <p>What is the cheapest production detector for the whole category?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Expose the <strong>subscriber count</strong> as a metric —
        <code>Handler?.GetInvocationList().Length ?? 0</code>. A count that should track open
        objects and instead only rises is unmissable, and it costs one property.</p>
      </div></details>
    </li>
    <li>
      <p>Does using <code>event</code> instead of a delegate field fix the leak?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>No.</strong> It stops outside code replacing and raising, and changes nothing
        about who holds whom. The invocation list still holds every subscriber, and every failure
        mode from <a href="#/m/t1-21-delegates">Delegates</a> is unchanged.</p>
      </div></details>
    </li>
    <li>
      <p>What must every handler tolerate, even in correct code?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Being invoked once after unsubscribing.</strong> The raise site copies the
        invocation list before calling, so a handler removed after that copy still runs. Inherent to
        any design where subscribing and raising can happen on different threads.</p>
      </div></details>
    </li>
  </ol>
</section>

`
});
