// 04-static-state.cs — a static field is one slot for the whole process. That
// is the feature and the failure: everything sharing it includes code you did
// not write, and tests that run at the same time.
// .NET 10.0.400. Run: dotnet run 04-static-state.cs -c Release

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;

// ---- the tempting version -------------------------------------------------
static class CurrentTenant
{
    public static string? Id;          // "the tenant this request is for"
}

static class ReportBuilder
{
    public static string Build(string data) => $"[{CurrentTenant.Id}] {data}";
}

// ---- shared mutable collection --------------------------------------------
static class Registry
{
    public static readonly Dictionary<string, int> Counts = new();
}

// ---- the version that has no shared slot ----------------------------------
sealed class TenantContext
{
    public string Id { get; }
    public TenantContext(string id) => Id = id;
    public string Build(string data) => $"[{Id}] {data}";
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. two concurrent requests, one static slot ---");
        var results = new string[2];
        var b = new Barrier(2);
        Parallel.For(0, 2, i =>
        {
            CurrentTenant.Id = i == 0 ? "acme" : "globex";
            b.SignalAndWait();                 // force the interleaving to be visible
            Thread.Sleep(20);
            results[i] = ReportBuilder.Build($"request {i}");
        });
        foreach (var r in results) Console.WriteLine($"  {r}");
        Console.WriteLine("  Both requests read whichever value was written last.");
        Console.WriteLine("  In production this is one customer's data under another's name.");

        Console.WriteLine();
        Console.WriteLine("--- 2. the same code with no shared slot ---");
        var safe = new string[2];
        Parallel.For(0, 2, i =>
        {
            var ctx = new TenantContext(i == 0 ? "acme" : "globex");
            Thread.Sleep(20);
            safe[i] = ctx.Build($"request {i}");
        });
        foreach (var r in safe) Console.WriteLine($"  {r}");

        Console.WriteLine();
        Console.WriteLine("--- 3. a shared Dictionary is not thread-safe ---");
        Registry.Counts.Clear();
        Exception? caught = null;
        try
        {
            Parallel.For(0, 40_000, i =>
            {
                Registry.Counts[$"k{i % 500}"] = i;
            });
        }
        catch (AggregateException ex)
        {
            caught = ex.InnerException;
        }
        Console.WriteLine($"  exception: {caught?.GetType().Name ?? "(none this run)"}");
        Console.WriteLine($"  entries after the run: {Registry.Counts.Count} (expected 500)");
        Console.WriteLine("  Corruption here is intermittent: a clean run proves nothing.");

        Console.WriteLine();
        Console.WriteLine("--- 4. statics the framework owns are the same problem ---");
        var before = CultureInfo.CurrentCulture.Name;
        Console.WriteLine($"  thread culture before : {before}");
        Console.WriteLine($"  1234.5 formatted      : {1234.5.ToString("N2")}");
        CultureInfo.CurrentCulture = new CultureInfo("de-DE");
        Console.WriteLine($"  after setting de-DE   : {1234.5.ToString("N2")}");
        CultureInfo.CurrentCulture = new CultureInfo(before);
        Console.WriteLine($"  restored              : {1234.5.ToString("N2")}");
        Console.WriteLine("  Any library on this thread now formats differently, and nothing");
        Console.WriteLine("  in its signature said it could be affected.");
    }
}
