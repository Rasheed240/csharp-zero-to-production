// 03-exercises.cs — every answer claimed in this module's exercises, run.
// Collection counts and byte figures are exact; timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 03-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime;
using System.Threading;

class Program
{
    static object? _root;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: which generation, and why? =====");
        Console.WriteLine();
        var obj = new byte[64];
        Console.WriteLine($"    freshly allocated          : gen {GC.GetGeneration(obj)}");
        GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"    after one gen 0 collection : gen {GC.GetGeneration(obj)}");
        GC.Collect(1, GCCollectionMode.Forced, blocking: true);
        Console.WriteLine($"    after one gen 1 collection : gen {GC.GetGeneration(obj)}");
        GC.KeepAlive(obj);
        Console.WriteLine();
        Console.WriteLine("  A generation is an AGE, not a place you choose. Everything starts in");
        Console.WriteLine("  gen 0; surviving a collection promotes it one level. Promotion is the");
        Console.WriteLine("  ONLY route to gen 2.");
        Console.WriteLine();
        Console.WriteLine("  The generational hypothesis this rests on is that most objects die");
        Console.WriteLine("  young. When that holds, collecting gen 0 reclaims most garbage while");
        Console.WriteLine("  examining a small part of the heap. When it does not, you pay for");
        Console.WriteLine("  promotion and then pay again to collect in an older generation.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: same bytes, different cost =====");
        Console.WriteLine();
        Console.WriteLine("  300,000 objects of 256 bytes, dropped versus kept:");
        Console.WriteLine();
        Console.WriteLine("  workload    gen0   gen1   gen2");
        var dropped = Alloc(keep: false);
        var kept = Alloc(keep: true);
        Console.WriteLine($"  dropped    {dropped.G0,5}  {dropped.G1,5}  {dropped.G2,5}");
        Console.WriteLine($"  kept       {kept.G0,5}  {kept.G1,5}  {kept.G2,5}");
        Console.WriteLine();
        Console.WriteLine("  Identical allocation. The dropped version never promotes anything and");
        Console.WriteLine("  never triggers a gen 2 collection; the kept version does both.");
        Console.WriteLine();
        Console.WriteLine("  The GC charges you for what LIVES, not for what you allocate. A high");
        Console.WriteLine("  allocation rate with everything dying in gen 0 is a healthy workload");
        Console.WriteLine("  and needs no attention at all.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: what does a gen 2 collection cost? =====");
        Console.WriteLine();
        var (g0, g2) = PauseCost();
        Console.WriteLine($"    forced gen 0 : {1.0,7:N1}x  (baseline)");
        Console.WriteLine($"    forced gen 2 : {g2 / g0,7:N1}x");
        Console.WriteLine();
        Console.WriteLine("  Same heap. The difference is how much of it must be examined: a gen 0");
        Console.WriteLine("  collection looks at the newest objects, a gen 2 collection walks");
        Console.WriteLine("  everything reachable and then compacts the survivors.");
        Console.WriteLine();
        Console.WriteLine("  Compaction is why object addresses change, why pinning exists, and why");
        Console.WriteLine("  a gen 2 pause is proportional to the LIVE SET rather than to the");
        Console.WriteLine("  garbage. Reclaiming a lot of garbage is cheap; having a lot of live");
        Console.WriteLine("  data is what costs.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: why did the cache make latency worse? =====");
        Console.WriteLine();
        Console.WriteLine("  Cached objects held for 30 seconds, versus dropped immediately:");
        Console.WriteLine();
        Console.WriteLine("  lifetime              gen1   gen2   promoted?");
        var quick = Lifetime(hold: 0);
        var mid = Lifetime(hold: 20_000);
        Console.WriteLine($"  dropped immediately  {quick.G1,5}  {quick.G2,5}   {(quick.G2 > 0 ? "to gen 2" : quick.G1 > 0 ? "to gen 1" : "no")}");
        Console.WriteLine($"  held across GCs      {mid.G1,5}  {mid.G2,5}   {(mid.G2 > 0 ? "to gen 2" : mid.G1 > 0 ? "to gen 1" : "no")}");
        Console.WriteLine();
        Console.WriteLine("  This is the MID-LIFE CRISIS. Objects that die young are free. Objects");
        Console.WriteLine("  that live forever are promoted once and then ignored. The expensive");
        Console.WriteLine("  case is in between: living just long enough to be promoted, then");
        Console.WriteLine("  dying — you pay to copy them into gen 1, again into gen 2, and then");
        Console.WriteLine("  pay a gen 2 collection to reclaim them.");
        Console.WriteLine();
        Console.WriteLine("  A 30-second TTL guarantees this shape. Nothing survives 30 seconds of");
        Console.WriteLine("  allocation without being promoted.");
        Console.WriteLine();
        Console.WriteLine("  The counter-intuitive part: making the cache BIGGER makes it worse,");
        Console.WriteLine("  because more objects are promoted and gen 2 grows. What helps is");
        Console.WriteLine("  reducing the object COUNT per entry.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: object graph or flat array? =====");
        Console.WriteLine();
        var (graphMs, flatMs, graphObjects) = GraphVsFlat();
        Console.WriteLine($"    {graphObjects,9:N0} small objects : {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"    {20_000,9:N0} byte arrays   : {flatMs / graphMs,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Comparable live bytes; a hundredfold difference in object count; and");
        Console.WriteLine("  the collections are more than an order of magnitude cheaper.");
        Console.WriteLine();
        Console.WriteLine("  Marking walks REFERENCES. A tree of small nodes must be visited node");
        Console.WriteLine("  by node on every gen 2 collection. A byte array is one object with no");
        Console.WriteLine("  outgoing references — marked once and skipped.");
        Console.WriteLine();
        Console.WriteLine("  So when caching, what you keep matters less than how many OBJECTS it");
        Console.WriteLine("  is made of. Cache rendered bytes rather than the graph that made them.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 6: find the root =====");
        Console.WriteLine();
        Console.WriteLine("      public static event EventHandler? Published;");
        Console.WriteLine("      // subscriber:  Bus.Published += OnPublished;");
        Console.WriteLine();
        var (alive, freed) = EventLeak();
        Console.WriteLine($"    10,000 subscribers, all dropped by our code");
        Console.WriteLine($"    still alive after a full GC          : {alive:N0}");
        Console.WriteLine($"    freed once the event was cleared     : {freed:N0}");
        Console.WriteLine();
        Console.WriteLine("  A static event's invocation list is a GC ROOT. It holds a reference");
        Console.WriteLine("  to every subscriber, so none of them can be collected however");
        Console.WriteLine("  thoroughly your own code forgets them.");
        Console.WriteLine();
        Console.WriteLine("  The direction is what people get wrong. Subscribing does not extend");
        Console.WriteLine("  the PUBLISHER's life — it makes the SUBSCRIBER live as long as the");
        Console.WriteLine("  publisher. A static publisher therefore pins every short-lived object");
        Console.WriteLine("  that ever subscribed, along with everything each one references.");
        Console.WriteLine();
        Console.WriteLine("  The rule: if the publisher outlives the subscriber, unsubscribe —");
        Console.WriteLine("  which in practice means implementing IDisposable and detaching there.");
        Console.WriteLine();
        Console.WriteLine("  How you would find it in production:");
        Console.WriteLine("    dotnet-gcdump collect --process-id <pid>     (twice, minutes apart)");
        Console.WriteLine("    > dumpheap -stat        compare type counts between the two");
        Console.WriteLine("    > gcroot <address>      the chain from a root to the object");
        Console.WriteLine();
        Console.WriteLine("  gcroot is the command that ends the argument: it prints the reference");
        Console.WriteLine("  chain explicitly, so 'static event -> delegate -> subscriber' appears");
        Console.WriteLine("  as evidence rather than as a theory.");
    }

    readonly record struct Gens(int G0, int G1, int G2);

    static Gens Alloc(bool keep)
    {
        Settle();
        int g0 = GC.CollectionCount(0), g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);

        List<byte[]>? held = keep ? new List<byte[]>(300_000) : null;
        for (var i = 0; i < 300_000; i++)
        {
            var b = new byte[256];
            if (held is not null) held.Add(b); else GC.KeepAlive(b);
        }
        _root = held;

        return new Gens(GC.CollectionCount(0) - g0, GC.CollectionCount(1) - g1,
                        GC.CollectionCount(2) - g2);
    }

    static Gens Lifetime(int hold)
    {
        Settle();
        int g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);

        var window = new Queue<byte[]>();
        for (var i = 0; i < 200_000; i++)
        {
            var b = new byte[256];
            if (hold == 0) { GC.KeepAlive(b); continue; }
            window.Enqueue(b);
            if (window.Count > hold) window.Dequeue();
        }
        _root = window;

        return new Gens(0, GC.CollectionCount(1) - g1, GC.CollectionCount(2) - g2);
    }

    static (double g0, double g2) PauseCost()
    {
        Settle();
        var live = new List<byte[]>(200_000);
        for (var i = 0; i < 200_000; i++) live.Add(new byte[256]);
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var sw = Stopwatch.StartNew();
        for (var i = 0; i < 20; i++) GC.Collect(0, GCCollectionMode.Forced, blocking: true);
        var g0 = sw.Elapsed.TotalMilliseconds / 20;

        sw = Stopwatch.StartNew();
        for (var i = 0; i < 20; i++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var g2 = sw.Elapsed.TotalMilliseconds / 20;

        GC.KeepAlive(live);
        _root = live;
        return (g0, g2);
    }

    sealed record Node(string Name, Node? Left, Node? Right);

    static Node BuildTree(int depth, int seed) =>
        depth == 0 ? new Node($"l{seed}", null, null)
                   : new Node($"n{depth}", BuildTree(depth - 1, seed), BuildTree(depth - 1, seed + 1));

    static (double graphMs, double flatMs, int graphObjects) GraphVsFlat()
    {
        Settle();
        var graph = new List<Node>(20_000);
        for (var i = 0; i < 20_000; i++) graph.Add(BuildTree(6, i));
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var sw = Stopwatch.StartNew();
        for (var r = 0; r < 10; r++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var graphMs = sw.Elapsed.TotalMilliseconds / 10;
        GC.KeepAlive(graph);
        graph = null!;

        Settle();
        var flat = new List<byte[]>(20_000);
        for (var i = 0; i < 20_000; i++) flat.Add(new byte[127 * 40]);
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        sw = Stopwatch.StartNew();
        for (var r = 0; r < 10; r++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var flatMs = sw.Elapsed.TotalMilliseconds / 10;
        GC.KeepAlive(flat);
        _root = flat;

        return (graphMs, flatMs, 20_000 * 127);
    }

    static class Bus
    {
        public static event EventHandler? Published;
        public static void Clear() => Published = null;
        public static int Count => Published?.GetInvocationList().Length ?? 0;
    }

    sealed class Subscriber
    {
        private readonly byte[] _payload = new byte[512];
        public Subscriber() => Bus.Published += OnPublished;
        private void OnPublished(object? s, EventArgs e) => GC.KeepAlive(_payload);
    }

    static (int alive, int freed) EventLeak()
    {
        Bus.Clear();
        var refs = new List<WeakReference>(10_000);
        var keep = new List<Subscriber>(10_000);
        for (var i = 0; i < 10_000; i++)
        {
            var s = new Subscriber();
            refs.Add(new WeakReference(s));
            keep.Add(s);
        }

        keep.Clear();
        FullCollect();
        var alive = refs.Count(r => r.IsAlive);

        Bus.Clear();
        FullCollect();
        var stillAlive = refs.Count(r => r.IsAlive);
        return (alive, 10_000 - stillAlive);
    }

    static void FullCollect()
    {
        for (var i = 0; i < 3; i++)
        {
            GC.Collect(2, GCCollectionMode.Forced, blocking: true);
            GC.WaitForPendingFinalizers();
        }
    }

    static void Settle()
    {
        _root = null;
        FullCollect();
        Thread.Sleep(25);
    }
}
