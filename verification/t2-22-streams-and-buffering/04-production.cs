// 04-production.cs — Ledger's settlement import, and the difference between
// memory that scales with the file and memory that does not.
//
// The incident: the importer ran for two years on files of 20-80 MB. A partner
// sent 900 MB and the pod was OOM-killed. The code had no bug in it - it was
// written to hold the whole file.
//
// Run:  dotnet run 04-production.cs -c Release
//
// EXACT vs RATIO: peak-memory figures are exact for this run and the SHAPE is
// the claim - one grows with the file, the other does not.

using System.Buffers;
using System.Diagnostics;
using System.Globalization;
using System.Text;

string workDir = Path.Combine(Path.GetTempPath(), "ledger-t2-22-prod-" + Environment.ProcessId);
Directory.CreateDirectory(workDir);

try
{
    Console.WriteLine("   file size   strategy         peak managed   allocated       time   records");
    Console.WriteLine("   ---------   --------         ------------   ---------       ----   -------");

    foreach (int records in new[] { 50_000, 200_000, 800_000 })
    {
        string path = Path.Combine(workDir, $"settlement-{records}.csv");
        CreateSettlementFile(path, records);
        long fileSize = new FileInfo(path).Length;

        Report(fileSize, "ReadAllText   ", () => ImportBuffered(path));
        Report(fileSize, "StreamReader  ", () => ImportStreamed(path));

        File.Delete(path);
        Console.WriteLine();
    }

    Explain();
}
finally
{
    try
    {
        Directory.Delete(workDir, recursive: true);
    }
    catch (IOException)
    {
        Console.WriteLine($"(could not delete {workDir})");
    }
}

// ---------------------------------------------------------------------------
// WRONG - reads the whole file into a string, then splits it into more strings.
// Peak memory is several times the file size.
// ---------------------------------------------------------------------------
static (long Total, int Count) ImportBuffered(string path)
{
    string text = File.ReadAllText(path);
    string[] lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);

    long total = 0;
    int count = 0;

    foreach (string line in lines)
    {
        string[] fields = line.Split(',');
        if (fields.Length < 3)
        {
            continue;
        }

        total += long.Parse(fields[2], CultureInfo.InvariantCulture);
        count++;
    }

    return (total, count);
}

// ---------------------------------------------------------------------------
// RIGHT - one line at a time, and the line parsed with spans. Peak memory is
// the size of the longest line.
// ---------------------------------------------------------------------------
static (long Total, int Count) ImportStreamed(string path)
{
    using var file = new FileStream(path, FileMode.Open, FileAccess.Read,
        FileShare.Read, bufferSize: 64 * 1024);
    using var reader = new StreamReader(file, Encoding.UTF8, detectEncodingFromByteOrderMarks: false,
        bufferSize: 64 * 1024);

    long total = 0;
    int count = 0;

    string? line;
    while ((line = reader.ReadLine()) is not null)
    {
        ReadOnlySpan<char> span = line;

        // Walk to the third comma-separated field without allocating.
        int first = span.IndexOf(',');
        if (first < 0)
        {
            continue;
        }

        ReadOnlySpan<char> rest = span[(first + 1)..];
        int second = rest.IndexOf(',');
        if (second < 0)
        {
            continue;
        }

        ReadOnlySpan<char> amountField = rest[(second + 1)..];
        int third = amountField.IndexOf(',');
        if (third >= 0)
        {
            amountField = amountField[..third];
        }

        if (long.TryParse(amountField, CultureInfo.InvariantCulture, out long amount))
        {
            total += amount;
            count++;
        }
    }

    return (total, count);
}

// ---------------------------------------------------------------------------
static void Report(long fileSize, string label, Func<(long, int)> import)
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long baseline = GC.GetTotalMemory(true);
    long allocBefore = GC.GetTotalAllocatedBytes(precise: true);
    long peak = baseline;

    using var stop = new CancellationTokenSource();
    var sampler = new Thread(() =>
    {
        while (!stop.IsCancellationRequested)
        {
            long now = GC.GetTotalMemory(false);
            if (now > peak)
            {
                peak = now;
            }

            Thread.Sleep(1);
        }
    })
    {
        IsBackground = true
    };

    sampler.Start();
    var sw = Stopwatch.StartNew();
    (long total, int count) = import();
    sw.Stop();
    stop.Cancel();
    sampler.Join();

    long allocated = GC.GetTotalAllocatedBytes(precise: true) - allocBefore;

    Console.WriteLine($"   {fileSize / 1024 / 1024,6:N0} MB   {label}   {(peak - baseline) / 1024.0 / 1024.0,9:F1} MB   " +
        $"{allocated / 1024.0 / 1024.0,6:F0} MB   {sw.Elapsed.TotalMilliseconds,6:F0} ms   {count,7:N0}");

    _ = total;
}

// ---------------------------------------------------------------------------
static void Explain()
{
    Console.WriteLine("   The peak column is the one that mattered.");
    Console.WriteLine();
    Console.WriteLine("   ReadAllText's peak grows with the file, and grows FASTER than the");
    Console.WriteLine("   file, because three copies exist at once: the byte array read from");
    Console.WriteLine("   disk, the UTF-16 string it decodes to at two bytes per character,");
    Console.WriteLine("   and the array of substrings that Split produces.");
    Console.WriteLine();
    Console.WriteLine("   The streamed peak is flat. It is one 64 KB buffer plus the current");
    Console.WriteLine("   line, whatever the file size.");
    Console.WriteLine();
    Console.WriteLine("   That is the property that ended the incident. The buffered version");
    Console.WriteLine("   was always going to fail at SOME file size and the only question");
    Console.WriteLine("   was which partner sent it first. The streamed version cannot fail");
    Console.WriteLine("   on a bigger file, because its memory does not depend on the size.");
    Console.WriteLine();
    Console.WriteLine("   Note the allocated column tells a different story from peak. The");
    Console.WriteLine("   streamed version still allocates a string per line from ReadLine.");
    Console.WriteLine("   Those die in gen 0 and never accumulate, so they cost collection");
    Console.WriteLine("   time and not memory - which is the distinction between allocation");
    Console.WriteLine("   rate and live set that decides whether a service falls over.");
    Console.WriteLine();
    Console.WriteLine("   Removing even that needs reading UTF-8 bytes and framing lines by");
    Console.WriteLine("   hand, which is the subject of the next module.");
}

// ---------------------------------------------------------------------------
static void CreateSettlementFile(string path, int records)
{
    using var file = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024);
    using var writer = new StreamWriter(file, new UTF8Encoding(false), 64 * 1024);

    string[] currencies = { "GBP", "EUR", "USD" };

    for (int i = 0; i < records; i++)
    {
        writer.Write("INV-2026-");
        writer.Write(i.ToString("D7", CultureInfo.InvariantCulture));
        writer.Write(',');
        writer.Write(currencies[i % 3]);
        writer.Write(',');
        writer.Write((100_000 + i % 800_000).ToString(CultureInfo.InvariantCulture));
        writer.Write(",2026-03-14\n");
    }
}
