// 02-production.cs — Ledger's response cache. A 30-second TTL that guaranteed
// every entry would be promoted to gen 2 before it expired, and the static event
// handler that kept objects alive nobody could find.
//
// Collection counts and byte figures are exact. Timings are ratios.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 02-production.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime;
using System.Threading;

namespace Ledger.Caching;

public sealed record CachedResponse(string Key, byte[] Body, DateTime CachedAt);

class Program
{
    static object? _root;

    static void Main()
    {
        Console.WriteLine("=== the incident ===");
        Console.WriteLine();
        Console.WriteLine("  Ledger caches rendered responses for 30 seconds to take load off the");
        Console.WriteLine("  reporting database. It worked: database load dropped by two thirds.");
        Console.WriteLine();
        Console.WriteLine("  Latency got worse. p99 roughly doubled, in a pattern nobody could");
        Console.WriteLine("  correlate with anything — spikes every few seconds, on requests that");
        Console.WriteLine("  were cache HITS and should have been the fastest in the system.");
        Console.WriteLine();
        Console.WriteLine("  The cache was not slow. The cache was creating a garbage collection");
        Console.WriteLine("  problem, and the spikes were pauses.");
        Console.WriteLine();
        Console.WriteLine("  lifetime of cached objects       gen0   gen1   gen2   promoted?");

        Report("dropped immediately", Lifetime(surviveMs: 0));
        Report("held briefly (gen 0 only)", Lifetime(surviveMs: 1));
        Report("held across collections", Lifetime(surviveMs: 50));

        Console.WriteLine();
        Console.WriteLine("  Read the gen1 and gen2 columns, not a timing. The wall-clock cost of");
        Console.WriteLine("  these three runs is dominated by allocation and bookkeeping rather");
        Console.WriteLine("  than by collection, so a time ratio here would mislead — an earlier");
        Console.WriteLine("  version of this file printed one and the middle row came out FASTER");
        Console.WriteLine("  than the baseline. The collection counts are exact and are the signal.");
        Console.WriteLine();
        Console.WriteLine("  This is the MID-LIFE CRISIS, and it is the most important shape in");
        Console.WriteLine("  this module.");
        Console.WriteLine();
        Console.WriteLine("  An object that dies immediately is collected in gen 0 and costs");
        Console.WriteLine("  almost nothing. An object that lives forever is promoted once and");
        Console.WriteLine("  then ignored. The expensive case is the one in between: objects that");
        Console.WriteLine("  live JUST long enough to be promoted, and then die.");
        Console.WriteLine();
        Console.WriteLine("  You pay to copy them into gen 1, pay again to copy them into gen 2,");
        Console.WriteLine("  and then pay a gen 2 collection to reclaim them — the most expensive");
        Console.WriteLine("  collection there is (01-generations.cs measured it at hundreds of");
        Console.WriteLine("  times a gen 0). All for objects you were going to throw away.");
        Console.WriteLine();
        Console.WriteLine("  A 30-second TTL guarantees this. Nothing survives 30 seconds of");
        Console.WriteLine("  allocation in gen 0.");

        Console.WriteLine();
        Console.WriteLine("=== what actually helped ===");
        Console.WriteLine();
        Console.WriteLine("  The instinct is to make the cache bigger or the TTL longer, on the");
        Console.WriteLine("  theory that more hits means less work. It makes the GC problem worse:");
        Console.WriteLine("  more objects promoted, a larger gen 2, longer pauses.");
        Console.WriteLine();
        Console.WriteLine("  cache size    gen2 collections   heap MB   relative time");
        SizeReport("1,000 entries", CacheSize(1_000));
        SizeReport("20,000 entries", CacheSize(20_000));
        SizeReport("100,000 entries", CacheSize(100_000));
        Console.WriteLine();
        Console.WriteLine("  What helped was reducing what each entry COSTS to keep, not how long");
        Console.WriteLine("  it is kept:");
        Console.WriteLine();
        Console.WriteLine("    - cache the rendered bytes, not the object graph that produced them");
        Console.WriteLine("    - one array per entry rather than a tree of small objects, because");
        Console.WriteLine("      the GC walks references and a flat payload has none");
        Console.WriteLine("    - a hard size limit, so gen 2 has a ceiling");
        Console.WriteLine();
        var (graphMs, flatMs, graphRefs, flatRefs) = GraphVersusFlat();
        Console.WriteLine("  Comparable live BYTES, held two ways. This times the COLLECTIONS");
        Console.WriteLine("  only, with the live set already built:");
        Console.WriteLine();
        Console.WriteLine($"  as an object graph ({graphRefs,7:N0} objects) : {1.0,6:N2}x  (baseline)");
        Console.WriteLine($"  as flat arrays     ({flatRefs,7:N0} objects) : {flatMs / graphMs,6:N2}x");
        Console.WriteLine();
        Console.WriteLine("  Roughly the same live BYTES. A hundredfold difference in OBJECT");
        Console.WriteLine("  COUNT. The collections are more than an order of magnitude cheaper,");
        Console.WriteLine("  so the cost follows the object count and not the bytes.");
        Console.WriteLine();
        Console.WriteLine("  This needs a real live set to show: at a tenth of this size the two");
        Console.WriteLine("  were indistinguishable, because fixed per-collection overhead");
        Console.WriteLine("  dominated. That is worth knowing before you benchmark your own.");
        Console.WriteLine();
        Console.WriteLine("  Marking walks references. A tree of small nodes means the GC visits");
        Console.WriteLine("  every one of them on every gen 2 collection; a byte array is one");
        Console.WriteLine("  object with no outgoing references, so it is marked once and skipped.");
        Console.WriteLine();
        Console.WriteLine("  That is the practical lesson for caching: what you keep matters less");
        Console.WriteLine("  than how many OBJECTS it is made of.");

        Console.WriteLine();
        Console.WriteLine("=== the second bug: the roots nobody could see ===");
        Console.WriteLine();
        Console.WriteLine("  A separate leak in the same service. Objects were unreachable from");
        Console.WriteLine("  any code anyone could find, and were not being collected.");
        Console.WriteLine();
        var (leaked, collected) = EventHandlerLeak();
        Console.WriteLine($"    subscribers created                    : 10,000");
        Console.WriteLine($"    still alive after a full GC            : {leaked:N0}");
        Console.WriteLine($"    collected once the event was cleared   : {collected:N0}");
        Console.WriteLine();
        Console.WriteLine("  A static event holds a reference to every subscriber. The subscriber");
        Console.WriteLine("  is 'gone' as far as your code is concerned and the event's invocation");
        Console.WriteLine("  list is a ROOT, so it and everything it references stays alive for");
        Console.WriteLine("  the life of the process.");
        Console.WriteLine();
        Console.WriteLine("  The direction is the part people get wrong. Subscribing does not make");
        Console.WriteLine("  the PUBLISHER live longer — it makes the SUBSCRIBER live as long as");
        Console.WriteLine("  the publisher. A static or long-lived publisher therefore pins every");
        Console.WriteLine("  short-lived object that ever subscribed.");
        Console.WriteLine();
        Console.WriteLine("  The rule: if the publisher outlives the subscriber, unsubscribe. In");
        Console.WriteLine("  practice that means a subscriber that implements IDisposable and");
        Console.WriteLine("  detaches in Dispose — and something that actually disposes it.");

        Console.WriteLine();
        Console.WriteLine("=== how the two were told apart ===");
        Console.WriteLine();
        Console.WriteLine("  Both raise gc-heap-size. They are distinguished by the gen 2 count and");
        Console.WriteLine("  by whether memory ever comes back:");
        Console.WriteLine();
        Console.WriteLine("    promotion pressure   heap rises and FALLS, gen2 count HIGH,");
        Console.WriteLine("                         time-in-gc high, latency spiky");
        Console.WriteLine("    a leak               heap rises and never falls, gen2 count high,");
        Console.WriteLine("                         and each collection reclaims less than the last");
        Console.WriteLine();
        Console.WriteLine("  The decisive step is a heap dump, because it answers the only question");
        Console.WriteLine("  that matters for a leak: WHAT IS HOLDING IT?");
        Console.WriteLine();
        Console.WriteLine("    dotnet-gcdump collect --process-id <pid>");
        Console.WriteLine("    dotnet-dump analyze <file>");
        Console.WriteLine("    > dumpheap -stat                 what is on the heap, by type");
        Console.WriteLine("    > gcroot <address>               what is keeping one alive");
        Console.WriteLine();
        Console.WriteLine("  gcroot is the command that ends the argument. It prints the chain from");
        Console.WriteLine("  a root to the object, so 'a static event -> a delegate -> your");
        Console.WriteLine("  subscriber' appears explicitly rather than being deduced.");
        Console.WriteLine();
        Console.WriteLine("  Take TWO gcdumps a few minutes apart and compare the type counts. A");
        Console.WriteLine("  type whose count only rises is the leak; a type that fluctuates is");
        Console.WriteLine("  promotion pressure, and needs a different fix.");
    }

    readonly record struct Counts(int Gen0, int Gen1, int Gen2, double Ms, double HeapMb);
    static Counts _baseline;

    /// <summary>
    /// Holds each object for a controlled span so it survives a controlled number
    /// of collections. surviveMs of 0 drops immediately; 50 spans several gen 0
    /// collections and forces promotion.
    /// </summary>
    static Counts Lifetime(int surviveMs)
    {
        Settle();
        var g0 = GC.CollectionCount(0);
        var g1 = GC.CollectionCount(1);
        var g2 = GC.CollectionCount(2);
        var sw = Stopwatch.StartNew();

        const int Entries = 120_000;
        var window = new Queue<CachedResponse>();
        var holdCount = surviveMs == 0 ? 0 : surviveMs * 400;

        for (var i = 0; i < Entries; i++)
        {
            var entry = new CachedResponse($"K{i}", new byte[256], DateTime.UtcNow);
            if (holdCount == 0) { GC.KeepAlive(entry); continue; }
            window.Enqueue(entry);
            if (window.Count > holdCount) window.Dequeue();
        }
        sw.Stop();
        _root = window;

        return new Counts(GC.CollectionCount(0) - g0, GC.CollectionCount(1) - g1,
                          GC.CollectionCount(2) - g2, sw.Elapsed.TotalMilliseconds,
                          GC.GetTotalMemory(false) / 1024.0 / 1024.0);
    }

    static void Report(string label, Counts c)
    {
        if (label == "dropped immediately") _baseline = c;
        var promoted = c.Gen1 == 0 && c.Gen2 == 0 ? "no"
                     : c.Gen2 == 0 ? "to gen 1"
                     : "to gen 2";
        Console.WriteLine($"  {label,-30} {c.Gen0,5}  {c.Gen1,5}  {c.Gen2,5}   {promoted,9}");
    }

    static Counts CacheSize(int entries)
    {
        Settle();
        var g2 = GC.CollectionCount(2);
        var sw = Stopwatch.StartNew();

        var cache = new Dictionary<string, CachedResponse>(entries);
        for (var i = 0; i < entries; i++)
            cache[$"K{i}"] = new CachedResponse($"K{i}", new byte[512], DateTime.UtcNow);

        // Churn: replace a tenth of the cache, as expiry would.
        for (var round = 0; round < 10; round++)
            for (var i = 0; i < entries / 10; i++)
                cache[$"K{i}"] = new CachedResponse($"K{i}", new byte[512], DateTime.UtcNow);

        sw.Stop();
        _root = cache;
        return new Counts(0, 0, GC.CollectionCount(2) - g2, sw.Elapsed.TotalMilliseconds,
                          GC.GetTotalMemory(false) / 1024.0 / 1024.0);
    }

    static Counts _sizeBaseline;

    static void SizeReport(string label, Counts c)
    {
        if (label == "1,000 entries") _sizeBaseline = c;
        Console.WriteLine($"  {label,-14} {c.Gen2,16}   {c.HeapMb,7:N1}   " +
                          $"{c.Ms / _sizeBaseline.Ms,13:N2}x");
    }

    sealed record Node(string Name, Node? Left, Node? Right);

    /// <summary>
    /// Times ONLY the collections, with the live set already built. An earlier
    /// version timed construction as well, so it reported the cost of building a
    /// tree rather than the cost of marking one — the flat version came out 100x
    /// faster, which said nothing about the GC.
    /// </summary>
    static (double graphMs, double flatMs, int graphRefs, int flatRefs) GraphVersusFlat()
    {
        // A live set of roughly equal BYTES, one as a reference graph and one flat.
        Settle();
        var graph = new List<Node>(20_000);
        for (var i = 0; i < 20_000; i++) graph.Add(BuildTree(depth: 6, i));
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var sw = Stopwatch.StartNew();
        for (var r = 0; r < 10; r++) GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        var graphMs = sw.Elapsed.TotalMilliseconds / 10;
        var graphRefs = 20_000 * 127;                 // nodes in a depth-6 binary tree
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

        return (graphMs, flatMs, graphRefs, 20_000);
    }

    static Node BuildTree(int depth, int seed) =>
        depth == 0
            ? new Node($"leaf{seed}", null, null)
            : new Node($"n{depth}", BuildTree(depth - 1, seed), BuildTree(depth - 1, seed + 1));

    // --- the event handler leak ----------------------------------------------
    static class Bus
    {
        public static event EventHandler? Published;
        public static void Raise() => Published?.Invoke(null, EventArgs.Empty);
        public static void Clear() => Published = null;
    }

    sealed class Subscriber
    {
        private readonly byte[] _payload = new byte[1024];
        public Subscriber() => Bus.Published += OnPublished;
        public void Unsubscribe() => Bus.Published -= OnPublished;
        private void OnPublished(object? s, EventArgs e) => GC.KeepAlive(_payload);
    }

    static (int leaked, int collected) EventHandlerLeak()
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

        keep.Clear();                       // nothing in OUR code references them now
        FullCollect();
        var leaked = refs.Count(r => r.IsAlive);

        Bus.Clear();                        // the only remaining reference was the event
        FullCollect();
        var stillAlive = refs.Count(r => r.IsAlive);

        return (leaked, 10_000 - stillAlive);
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
        Thread.Sleep(30);
    }
}
