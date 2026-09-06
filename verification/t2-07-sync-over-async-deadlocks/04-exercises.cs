// 04-exercises.cs — every answer claimed in this module's exercises, run.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 04-exercises.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static int _fetches;

    static void Main()
    {
        Console.WriteLine("===== Exercise 1: make this constructor legal =====");
        Console.WriteLine();
        var client = ReportClient.CreateAsync().GetAwaiter().GetResult();
        Console.WriteLine($"  {client.Describe()}");
        Console.WriteLine("  Private constructor taking the finished data; static async factory");
        Console.WriteLine("  doing the awaiting. No blocking anywhere.");
        Console.WriteLine();
        Console.WriteLine("  For DI specifically there is a second option worth knowing: register");
        Console.WriteLine("  the factory rather than the type, so the container awaits for you.");
        Console.WriteLine("      services.AddSingleton(sp => ReportClient.CreateAsync().Result);");
        Console.WriteLine("  That is still blocking, at startup. The genuinely clean version is");
        Console.WriteLine("  IHostedService.StartAsync, which the host awaits before serving.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 2: how many times does the fetch run? =====");
        Console.WriteLine();
        Console.WriteLine("  200 concurrent first callers against three cache implementations.");
        Console.WriteLine();
        foreach (var (name, run) in Caches())
        {
            Volatile.Write(ref _fetches, 0);
            Task.WhenAll(Enumerable.Range(0, 200).Select(_ => run())).GetAwaiter().GetResult();
            Console.WriteLine($"    {name,-34} {Volatile.Read(ref _fetches),4} fetch(es)");
        }
        Console.WriteLine();
        Console.WriteLine("  The check and the assignment are separated by an await, so without a");
        Console.WriteLine("  gate every caller arriving in that window starts its own fetch.");
        Console.WriteLine("  Caching the TASK rather than the value fixes it by construction —");
        Console.WriteLine("  there is only ever one Task, and awaiting it twice does not re-run");
        Console.WriteLine("  the work.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 3: which of these actually block? =====");
        Console.WriteLine();
        Console.WriteLine("  Four spellings people treat as meaningfully different. All four");
        Console.WriteLine("  return the value, and all four block the calling thread.");
        Console.WriteLine("  (The await baseline is deliberately NOT in this table: this file has");
        Console.WriteLine("  to block in Main to run anything, so it cannot honestly measure");
        Console.WriteLine("  not-blocking. 02-the-bad-options.cs does, with await at 72 ms and 10");
        Console.WriteLine("  threads against .Result at 2,827 ms and 44.)");
        Console.WriteLine();
        Console.WriteLine("  expression                                  blocks   ms");
        Time("WorkAsync().Result", () => WorkAsync().Result, blocks: "yes");
        Time("WorkAsync().GetAwaiter().GetResult()", () => WorkAsync().GetAwaiter().GetResult(), blocks: "yes");
        Time("Task.Run(() => WorkAsync()).Result", () => Task.Run(() => WorkAsync()).Result, blocks: "yes");
        Time("WorkAsync().Wait(); then .Result", () => { var t = WorkAsync(); t.Wait(); return t.Result; }, blocks: "yes");
        Console.WriteLine();
        Console.WriteLine("  All four block, at the same cost. They differ only in how they wrap");
        Console.WriteLine("  exceptions — .Result and .Wait() throw AggregateException, the other");
        Console.WriteLine("  two unwrap it — and Task.Run wastes a second thread doing it.");
        Console.WriteLine("  Choosing between them is choosing the error message on a bug you");
        Console.WriteLine("  still have.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: fix this without changing the interface =====");
        Console.WriteLine();
        Console.WriteLine("  IPricingRule.Apply(decimal) is synchronous and you do not own it.");
        Console.WriteLine("  Your implementation needs a remote FX rate. Options:");
        Console.WriteLine();
        var rule = FxPricingRule.LoadAsync("GBP").GetAwaiter().GetResult();
        var priced = rule.Apply(100m);
        Console.WriteLine($"    precomputed rule.Apply(100) = {priced}");
        Console.WriteLine("    and Apply did zero I/O — the rate was fetched in LoadAsync.");
        Console.WriteLine();
        Console.WriteLine("  This works because the rate is needed per REQUEST, not per CALL.");
        Console.WriteLine("  Hoisting the async work to the point where the data is still");
        Console.WriteLine("  request-scoped is the general move, and it is available far more");
        Console.WriteLine("  often than people expect.");
        Console.WriteLine();
        Console.WriteLine("  When it is NOT available — the synchronous call genuinely needs a");
        Console.WriteLine("  value nobody could have known in advance — you are choosing between");
        Console.WriteLine("  bad options, and 02-the-bad-options.cs ranks them.");

        Console.WriteLine();
        Console.WriteLine("===== Exercise 5: find the blocking calls in a binary =====");
        Console.WriteLine();
        Console.WriteLine("  You have a service you did not write and a starvation signature.");
        Console.WriteLine("  Three ways to find sync-over-async, cheapest first:");
        Console.WriteLine();
        Console.WriteLine("    1. Build-time. Add the analysers and read the warnings:");
        Console.WriteLine("         Microsoft.VisualStudio.Threading.Analyzers");
        Console.WriteLine("         VSTHRD002  synchronous wait on an async method");
        Console.WriteLine("         VSTHRD103  call the async version when in an async method");
        Console.WriteLine("         VSTHRD104  offer an async option");
        Console.WriteLine();
        Console.WriteLine("    2. Runtime, no dump. dotnet-counters, watching for the signature:");
        Console.WriteLine("         threadpool-thread-count   climbing");
        Console.WriteLine("         threadpool-queue-length   climbing");
        Console.WriteLine("         cpu-usage                 flat and low");
        Console.WriteLine("       Those three together mean blocked threads and nothing else.");
        Console.WriteLine();
        Console.WriteLine("    3. A dump, when you need the exact line:");
        Console.WriteLine("         dotnet-dump collect --process-id <pid>");
        Console.WriteLine("         > clrstack -all");
        Console.WriteLine("       Look for many threads sharing a frame containing GetResult,");
        Console.WriteLine("       Task.Wait, ManualResetEventSlim.Wait or Monitor.Wait.");
        Console.WriteLine();
        Console.WriteLine("  The ordering matters: (1) costs one build, (2) costs one command on");
        Console.WriteLine("  a live process, (3) costs a dump and an analysis session. Most teams");
        Console.WriteLine("  start at (3) because that is where the incident is.");
    }

    // --- Exercise 1 -----------------------------------------------------------
    sealed class ReportClient
    {
        private readonly int _templateCount;
        private ReportClient(int templateCount) => _templateCount = templateCount;

        public static async Task<ReportClient> CreateAsync(CancellationToken ct = default)
        {
            await Task.Delay(20, ct).ConfigureAwait(false);
            return new ReportClient(7);
        }

        public string Describe() => $"ReportClient with {_templateCount} templates, built without blocking";
    }

    // --- Exercise 2 -----------------------------------------------------------
    static async Task<int> FetchAsync()
    {
        Interlocked.Increment(ref _fetches);
        await Task.Delay(60).ConfigureAwait(false);
        return 42;
    }

    static IEnumerable<(string, Func<Task>)> Caches()
    {
        var naive = new NaiveCache();
        yield return ("naive: _v ??= await Fetch()", () => naive.GetAsync().AsTask());

        var gated = new GatedCache();
        yield return ("SemaphoreSlim + re-check", () => gated.GetAsync().AsTask());

        var lazy = new Lazy<Task<int>>(FetchAsync, LazyThreadSafetyMode.ExecutionAndPublication);
        yield return ("Lazy<Task<int>> (cache the Task)", () => lazy.Value);
    }

    sealed class NaiveCache
    {
        private int? _value;
        public async ValueTask<int> GetAsync()
        {
            _value ??= await FetchAsync().ConfigureAwait(false);
            return _value.Value;
        }
    }

    sealed class GatedCache
    {
        private readonly SemaphoreSlim _gate = new(1, 1);
        private int? _value;

        public async ValueTask<int> GetAsync()
        {
            if (_value is { } hit) return hit;
            await _gate.WaitAsync().ConfigureAwait(false);
            try { return _value ??= await FetchAsync().ConfigureAwait(false); }
            finally { _gate.Release(); }
        }
    }

    // --- Exercise 3 -----------------------------------------------------------
    static async Task<int> WorkAsync()
    {
        await Task.Delay(40).ConfigureAwait(false);
        return 1;
    }

    static void Time(string label, Func<int> f, string blocks)
    {
        var sw = Stopwatch.StartNew();
        var v = f();
        sw.Stop();
        Console.WriteLine($"  {label,-42} {blocks,-8} {sw.Elapsed.TotalMilliseconds,4:N0}  (={v})");
    }

    // --- Exercise 4 -----------------------------------------------------------
    interface IPricingRule
    {
        decimal Apply(decimal amount);
    }

    sealed class FxPricingRule : IPricingRule
    {
        private readonly decimal _rate;
        private FxPricingRule(decimal rate) => _rate = rate;

        public static async Task<FxPricingRule> LoadAsync(string currency, CancellationToken ct = default)
        {
            await Task.Delay(20, ct).ConfigureAwait(false);
            return new FxPricingRule(currency == "GBP" ? 1.00m : 1.17m);
        }

        public decimal Apply(decimal amount) => amount * _rate;
    }
}
