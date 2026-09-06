// 06-production.cs — Ledger's month-end invoice export.
//
// The incident: the export worked for a year, then started failing with
// OutOfMemoryException on a box with gigabytes free. Nothing leaked. The heap
// was full of holes.
//
// Run:  dotnet run 06-production.cs -c Release
//
// EXACT vs RATIO: LOH object counts and generation numbers are exact. Byte
// totals are exact for this run. Time comparisons are ratios.

using System.Diagnostics;
using System.Runtime;
using System.Text;

Console.WriteLine($"Server GC : {GCSettings.IsServerGC}");
Console.WriteLine();

var invoices = BuildInvoices(400_000);
Console.WriteLine($"Exporting {invoices.Count:N0} invoices");
Console.WriteLine();

BufferedExport(invoices);
GrowthPattern();
StreamedExport(invoices);
Verdict();

// ---------------------------------------------------------------------------
// The original implementation: build the whole CSV in memory, then write it.
// ---------------------------------------------------------------------------
static void BufferedExport(List<Invoice> invoices)
{
    Console.WriteLine("1. WRONG - build the whole export in memory first");
    Console.WriteLine();

    Collect();
    long g2Before = GC.CollectionCount(2);
    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    var builder = new StringBuilder();
    foreach (Invoice invoice in invoices)
    {
        builder.Append(invoice.Number).Append(',')
               .Append(invoice.CustomerName).Append(',')
               .Append(invoice.AmountMinor).Append(',')
               .Append(invoice.Currency).Append('\n');
    }

    // The finished string, then the finished byte array. Both are single
    // objects far over the LOH threshold.
    string csv = builder.ToString();
    byte[] payload = Encoding.UTF8.GetBytes(csv);

    sw.Stop();

    // GetGCMemoryInfo reports the LAST collection, not the current heap. Reading
    // it without collecting first returns figures from before this method ran.
    // Collect while csv and payload are still reachable, so the LOH numbers
    // below describe a heap that genuinely contains them.
    GC.Collect(2, GCCollectionMode.Forced, blocking: true);
    var info = GC.GetGCMemoryInfo();

    Console.WriteLine($"   time                 : {sw.Elapsed.TotalMilliseconds:F0} ms");
    Console.WriteLine($"   final string         : {csv.Length * 2L / 1024 / 1024:N0} MB (UTF-16, 2 bytes per char)");
    Console.WriteLine($"   final byte[]         : {payload.Length / 1024 / 1024:N0} MB");
    Console.WriteLine($"   string generation    : gen {GC.GetGeneration(csv)}");
    Console.WriteLine($"   byte[] generation    : gen {GC.GetGeneration(payload)}");
    Console.WriteLine($"   allocated in total   : {(GC.GetTotalAllocatedBytes(precise: true) - allocBefore) / 1024.0 / 1024.0:N0} MB");
    Console.WriteLine($"   gen 2 collections    : {GC.CollectionCount(2) - g2Before}");
    Console.WriteLine($"   LOH size             : {info.GenerationInfo[3].SizeAfterBytes / 1024.0 / 1024.0:F1} MB");
    Console.WriteLine($"   LOH fragmentation    : {info.GenerationInfo[3].FragmentationAfterBytes / 1024.0 / 1024.0:F1} MB");
    Console.WriteLine();
    Console.WriteLine("   Three copies of the same data exist at the peak: the StringBuilder");
    Console.WriteLine("   chunks, the string, and the byte array. All three are on the LOH.");
    Console.WriteLine();

    GC.KeepAlive(csv);
    GC.KeepAlive(payload);
}

// ---------------------------------------------------------------------------
// Why it degrades over time rather than failing on day one: every doubling
// allocates a NEW larger array and abandons the old one, on a heap that is
// never compacted.
// ---------------------------------------------------------------------------
static void GrowthPattern()
{
    Console.WriteLine("2. The growth pattern that fragments the heap");
    Console.WriteLine();
    Console.WriteLine("   A MemoryStream that doubles from 64 KB to 64 MB allocates every");
    Console.WriteLine("   intermediate size and abandons it:");
    Console.WriteLine();
    Console.WriteLine("   capacity      on LOH?   abandoned bytes");

    long abandoned = 0;
    for (int capacity = 65_536; capacity <= 67_108_864; capacity *= 2)
    {
        bool onLoh = capacity + 24 >= 85_000;
        if (onLoh && capacity < 67_108_864)
        {
            abandoned += capacity;
        }
        Console.WriteLine($"   {capacity / 1024,7:N0} KB      {(onLoh ? "yes" : "no "),-6}    {(onLoh && capacity < 67_108_864 ? $"{capacity / 1024:N0} KB" : "-"),15}");
    }

    Console.WriteLine();
    Console.WriteLine($"   total abandoned on the LOH to reach 64 MB: {abandoned / 1024.0 / 1024.0:F0} MB");
    Console.WriteLine();
    Console.WriteLine("   Each abandoned block leaves a hole of its exact size. The next");
    Console.WriteLine("   request needs a BIGGER contiguous block than any hole, so the heap");
    Console.WriteLine("   grows instead of reusing them. That is why the failure is");
    Console.WriteLine("   OutOfMemoryException on a machine with free memory: the allocator");
    Console.WriteLine("   needs one contiguous run, and there is not one.");
    Console.WriteLine();

    // Demonstrate the same effect for real.
    var kept = new List<byte[]>();
    for (int i = 0; i < 200; i++)
    {
        var doomed = new byte[1_000_000];
        doomed[0] = 1;
        var survivor = new byte[120_000];
        kept.Add(survivor);
    }
    Collect();
    var frag = GC.GetGCMemoryInfo().GenerationInfo[3];
    Console.WriteLine($"   reproduced: LOH {frag.SizeAfterBytes / 1024.0 / 1024.0:F1} MB holding " +
        $"{kept.Count * 120_000 / 1024.0 / 1024.0:F1} MB of live data, " +
        $"{frag.FragmentationAfterBytes / 1024.0 / 1024.0:F1} MB fragmented " +
        $"({100.0 * frag.FragmentationAfterBytes / frag.SizeAfterBytes:F0}% waste)");
    Console.WriteLine();
    kept.Clear();
    Collect();
}

// ---------------------------------------------------------------------------
// The fix. Nothing clever: never hold the whole thing, and keep every buffer
// under the LOH threshold.
// ---------------------------------------------------------------------------
static void StreamedExport(List<Invoice> invoices)
{
    Console.WriteLine("3. RIGHT - stream it, with a buffer under the threshold");
    Console.WriteLine();

    Collect();
    long g2Before = GC.CollectionCount(2);
    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    long peakLive = 0;
    var sw = Stopwatch.StartNew();

    // 64 KB: comfortably under 85,000 bytes, so this buffer lives in gen 0 and
    // is collected cheaply. Stream.Null stands in for the response body.
    using var output = Stream.Null;
    using var writer = new StreamWriter(output, Encoding.UTF8, bufferSize: 65_536, leaveOpen: true);

    int written = 0;
    foreach (Invoice invoice in invoices)
    {
        writer.Write(invoice.Number);
        writer.Write(',');
        writer.Write(invoice.CustomerName);
        writer.Write(',');
        writer.Write(invoice.AmountMinor);
        writer.Write(',');
        writer.Write(invoice.Currency);
        writer.Write('\n');

        if (++written % 20_000 == 0)
        {
            peakLive = Math.Max(peakLive, GC.GetTotalMemory(false));
        }
    }

    writer.Flush();
    sw.Stop();
    var info = GC.GetGCMemoryInfo();

    Console.WriteLine($"   time                 : {sw.Elapsed.TotalMilliseconds:F0} ms");
    Console.WriteLine($"   rows written         : {written:N0}");
    Console.WriteLine($"   peak live heap       : {peakLive / 1024.0 / 1024.0:F1} MB");
    Console.WriteLine($"   allocated in total   : {(GC.GetTotalAllocatedBytes(precise: true) - allocBefore) / 1024.0 / 1024.0:N0} MB");
    Console.WriteLine($"   gen 2 collections    : {GC.CollectionCount(2) - g2Before}");
    Console.WriteLine($"   LOH size             : {info.GenerationInfo[3].SizeAfterBytes / 1024.0 / 1024.0:F1} MB");
    Console.WriteLine();
    Console.WriteLine("   The peak live heap is the invoice list itself plus one 64 KB buffer.");
    Console.WriteLine("   It does not grow with the size of the export, which is the property");
    Console.WriteLine("   that matters: this version cannot fail on a bigger month.");
    Console.WriteLine();
}

static void Verdict()
{
    Console.WriteLine("4. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   The buffered version was not leaking. Every byte was reachable and");
    Console.WriteLine("   every byte was released afterwards. It failed because it demanded");
    Console.WriteLine("   single contiguous allocations from a heap that is never compacted.");
    Console.WriteLine();
    Console.WriteLine("   The three rules that follow from the measurements above:");
    Console.WriteLine("     1. Keep reusable buffers under 85,000 bytes total object size.");
    Console.WriteLine("     2. Never let a buffer size scale with input size.");
    Console.WriteLine("     3. If you must hold a large array, allocate it ONCE and reuse it.");
}

// ---------------------------------------------------------------------------

static List<Invoice> BuildInvoices(int count)
{
    var list = new List<Invoice>(count);
    for (int i = 0; i < count; i++)
    {
        list.Add(new Invoice(
            Number: $"INV-2026-{i:D7}",
            CustomerName: $"Customer {i % 5_000}",
            AmountMinor: 1_000L + i % 90_000,
            Currency: (i % 3) switch { 0 => "GBP", 1 => "EUR", _ => "USD" }));
    }
    return list;
}

static void Collect()
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
}

sealed record Invoice(string Number, string CustomerName, long AmountMinor, string Currency);
