// 04-production.cs — streaming a large export out of Ledger, the payments and
// invoicing service used throughout these modules. Measures what streaming buys
// against materialising, and what it costs when the consumer is slower.
// .NET 10.0.400. Run: dotnet run 04-production.cs -c Release

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;

namespace Ledger.Exports;

public sealed record Invoice(string Number, string CustomerId, decimal AmountMinor, DateOnly Issued);

/// <summary>Reads invoices from a file one line at a time. Never holds more than one.</summary>
public sealed class InvoiceFileReader
{
    private readonly string _path;
    public InvoiceFileReader(string path) => _path = path;

    public IEnumerable<Invoice> ReadAll()
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(_path);
        return Iterate(_path);

        static IEnumerable<Invoice> Iterate(string path)
        {
            using var reader = new StreamReader(path);
            string? line;
            var lineNumber = 0;
            while ((line = reader.ReadLine()) is not null)
            {
                lineNumber++;
                var parts = line.Split(',');
                if (parts.Length != 4)
                    throw new FormatException($"line {lineNumber}: expected 4 fields, got {parts.Length}");

                yield return new Invoice(
                    parts[0],
                    parts[1],
                    decimal.Parse(parts[2], CultureInfo.InvariantCulture),
                    DateOnly.ParseExact(parts[3], "yyyy-MM-dd", CultureInfo.InvariantCulture));
            }
        }
    }

    /// <summary>The eager equivalent, for comparison. Reads everything before returning.</summary>
    public IReadOnlyList<Invoice> ReadAllEagerly() => ReadAll().ToList();
}

class Program
{
    const int Rows = 300_000;

    static void Main()
    {
        var path = Path.Combine(Path.GetTempPath(), "ledger-invoices-demo.csv");
        Write(path, Rows);
        Console.WriteLine($"wrote {Rows:N0} invoice rows to a temp file " +
                          $"({new FileInfo(path).Length / 1024 / 1024} MB)");

        var reader = new InvoiceFileReader(path);

        Console.WriteLine();
        Console.WriteLine("--- total value, streaming ---");
        var streamed = Measure(() =>
        {
            decimal total = 0;
            foreach (var inv in reader.ReadAll()) total += inv.AmountMinor;
            return total;
        });
        Console.WriteLine($"  total {streamed.result:N0} minor units");
        Console.WriteLine($"  {streamed.ms:0} ms, {streamed.bytes / 1024 / 1024:N0} MB allocated");

        Console.WriteLine();
        Console.WriteLine("--- total value, materialised first ---");
        var eager = Measure(() =>
        {
            var all = reader.ReadAllEagerly();
            decimal total = 0;
            foreach (var inv in all) total += inv.AmountMinor;
            return total;
        });
        Console.WriteLine($"  total {eager.result:N0} minor units");
        Console.WriteLine($"  {eager.ms:0} ms, {eager.bytes / 1024 / 1024:N0} MB allocated");
        Console.WriteLine($"  same answer : {streamed.result == eager.result}");
        Console.WriteLine($"  allocation ratio : {(double)eager.bytes / streamed.bytes:0.0}x");
        Console.WriteLine("  Total allocation is nearly the same: both versions create one");
        Console.WriteLine("  Invoice per row. The difference is not how much is allocated,");
        Console.WriteLine("  it is how much is alive at once.");

        Console.WriteLine();
        Console.WriteLine("--- what is LIVE at the moment the answer is produced ---");
        var baseline = GC.GetTotalMemory(true);
        decimal t = 0;
        long liveWhileStreaming = 0;
        var seen = 0;
        foreach (var inv in reader.ReadAll())
        {
            t += inv.AmountMinor;
            if (++seen == Rows / 2) liveWhileStreaming = GC.GetTotalMemory(true) - baseline;
        }
        var list = reader.ReadAllEagerly();
        var liveWhileMaterialised = GC.GetTotalMemory(true) - baseline;
        Console.WriteLine($"  live heap halfway through streaming : {liveWhileStreaming / 1024:N0} KB");
        Console.WriteLine($"  live heap holding the whole list    : {liveWhileMaterialised / 1024 / 1024:N0} MB");
        Console.WriteLine($"  ratio : {(double)liveWhileMaterialised / Math.Max(liveWhileStreaming, 1):N0}x");
        GC.KeepAlive(list);
        GC.KeepAlive(t);

        Console.WriteLine();
        Console.WriteLine("--- peak working set is the real difference ---");
        Console.WriteLine("  Streaming holds ONE Invoice at a time. Materialising holds");
        Console.WriteLine($"  all {Rows:N0} plus the list's backing array, and cannot start");
        Console.WriteLine("  producing an answer until the last row is read.");

        Console.WriteLine();
        Console.WriteLine("--- first result latency ---");
        var sw = Stopwatch.StartNew();
        var firstStreamed = reader.ReadAll().First();
        sw.Stop();
        var t1 = sw.Elapsed.TotalMilliseconds;
        sw.Restart();
        var firstEager = reader.ReadAllEagerly()[0];
        sw.Stop();
        Console.WriteLine($"  streaming    : {t1:0.00} ms to the first invoice ({firstStreamed.Number})");
        Console.WriteLine($"  materialised : {sw.Elapsed.TotalMilliseconds:0.00} ms ({firstEager.Number})");
        Console.WriteLine("  The streaming reader stopped after one line. `using` inside the");
        Console.WriteLine("  iterator still closed the file, because First() disposes the");
        Console.WriteLine("  enumerator when it stops early.");

        Console.WriteLine();
        Console.WriteLine("--- a malformed row surfaces where the caller is looking ---");
        var badPath = Path.Combine(Path.GetTempPath(), "ledger-invoices-bad.csv");
        File.WriteAllLines(badPath, new[]
        {
            "INV-1,CUST-1,1000,2026-01-05",
            "INV-2,CUST-2,2000,2026-01-06",
            "INV-3,CUST-3,not-enough-fields"
        });
        var badReader = new InvoiceFileReader(badPath);
        var read = 0;
        try
        {
            foreach (var inv in badReader.ReadAll()) read++;
        }
        catch (FormatException ex)
        {
            Console.WriteLine($"  read {read} invoices, then: {ex.Message}");
        }
        Console.WriteLine("  Two good rows were already processed when it threw. A streaming");
        Console.WriteLine("  pipeline has no transaction: partial work is visible by design.");

        File.Delete(path);
        File.Delete(badPath);
    }

    static void Write(string path, int rows)
    {
        using var w = new StreamWriter(path);
        var day = new DateOnly(2026, 1, 1);
        for (var i = 1; i <= rows; i++)
            w.WriteLine($"INV-{i:D7},CUST-{i % 5000:D5},{(i % 90_000) + 100},{day.AddDays(i % 300):yyyy-MM-dd}");
    }

    static (decimal result, double ms, long bytes) Measure(Func<decimal> f)
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        var before = GC.GetAllocatedBytesForCurrentThread();
        var sw = Stopwatch.StartNew();
        var r = f();
        sw.Stop();
        var after = GC.GetAllocatedBytesForCurrentThread();
        return (r, sw.Elapsed.TotalMilliseconds, after - before);
    }
}
