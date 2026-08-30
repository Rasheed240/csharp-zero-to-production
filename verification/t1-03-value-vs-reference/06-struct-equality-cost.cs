using System.Diagnostics;

// Demo 5 — the cost of leaving struct equality to the default implementation.
const int Keys = 50_000;
const int Lookups = 500_000;

Dictionary<SlowKey, int> slow = new Dictionary<SlowKey, int>(Keys);
Dictionary<FastKey, int> fast = new Dictionary<FastKey, int>(Keys);

for (int i = 0; i < Keys; i++)
{
    slow[new SlowKey { Id = i, Code = "ACC" + i }] = i;
    fast[new FastKey(i, "ACC" + i)] = i;
}

// Warm up so the JIT has compiled both paths before we time anything.
Measure(() => Probe(slow, 1000));
Measure(() => Probe(fast, 1000));

long slowMs = Measure(() => Probe(slow, Lookups));
long fastMs = Measure(() => Probe(fast, Lookups));

Console.WriteLine($"struct with default equality : {slowMs,6} ms for {Lookups:N0} lookups");
Console.WriteLine($"readonly record struct       : {fastMs,6} ms for {Lookups:N0} lookups");
Console.WriteLine($"ratio                        : {(double)slowMs / Math.Max(fastMs, 1):F1}x");

static long Measure(Action action)
{
    Stopwatch sw = Stopwatch.StartNew();
    action();
    sw.Stop();
    return sw.ElapsedMilliseconds;
}

static void Probe<TKey>(Dictionary<TKey, int> map, int count) where TKey : notnull
{
    int found = 0;
    int i = 0;
    foreach (TKey key in map.Keys)
    {
        if (map.ContainsKey(key))
        {
            found++;
        }
        if (++i >= count)
        {
            break;
        }
    }
    if (found < 0)
    {
        Console.WriteLine(found);
    }
}

struct SlowKey
{
    public int Id;
    public string Code;
}

readonly record struct FastKey(int Id, string Code);
