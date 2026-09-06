// 04-production.cs — Ledger's statement archiver, and the handle leak that only
// appeared under load.
//
// The incident: a nightly job that wrote one file per customer statement started
// failing with IOException after about 20 minutes. It had worked for two years.
// The only change was that the customer count had grown.
//
// Run:  dotnet run 04-production.cs -c Release
//
// EXACT vs RATIO: handle counts are exact for this process at the moment sampled.
// The SHAPE of the two curves is the claim, not the absolute numbers, which
// depend on what else the runtime has open.

using System.Diagnostics;

string workDir = Path.Combine(Path.GetTempPath(), "ledger-t2-18-" + Environment.ProcessId);
Directory.CreateDirectory(workDir);

try
{
    Console.WriteLine($"Working directory : {workDir}");
    Console.WriteLine($"Baseline handles  : {CurrentHandles()}");
    Console.WriteLine();

    Leaking(workDir);
    FinaliserSafetyNet(workDir);
    Disposed(workDir);
    await AsyncVersion(workDir);
    Verdict();
}
finally
{
    // Clean up after ourselves regardless of how this exits.
    try
    {
        Directory.Delete(workDir, recursive: true);
    }
    catch (IOException)
    {
        Console.WriteLine();
        Console.WriteLine($"(could not delete {workDir}; some handles are still open)");
    }
}

// ---------------------------------------------------------------------------
// 1. The version that shipped. Every stream is abandoned, not closed.
// ---------------------------------------------------------------------------
static void Leaking(string workDir)
{
    Console.WriteLine("1. WRONG - the archiver as it shipped");
    Console.WriteLine();

    int start = CurrentHandles();
    var samples = new List<(int Written, int Handles)>();

    for (int i = 0; i < 400; i++)
    {
        // No using, no Dispose. The stream stays open until something
        // eventually finalises it - which may be never.
        var stream = new FileStream(
            Path.Combine(workDir, $"leak-{i}.txt"),
            FileMode.Create,
            FileAccess.Write);

        var writer = new StreamWriter(stream);
        writer.Write($"statement for customer {i}");
        writer.Flush();

        if ((i + 1) % 100 == 0)
        {
            samples.Add((i + 1, CurrentHandles()));
        }
    }

    Console.WriteLine($"   handles at start : {start}");
    Console.WriteLine();
    Console.WriteLine("   files written   handles   growth");
    foreach ((int written, int handles) in samples)
    {
        Console.WriteLine($"   {written,13}   {handles,7}   {handles - start,+6}");
    }

    Console.WriteLine();
    Console.WriteLine($"   handles per file: {(samples[^1].Handles - start) / (double)samples[^1].Written:F2}");
    Console.WriteLine();
    Console.WriteLine("   Exactly one handle per file, and nothing gives them back. The");
    Console.WriteLine("   growth column is a straight line: 100 files, 100 handles.");
    Console.WriteLine();
    Console.WriteLine("   Windows allows a very large number of handles per process, so this");
    Console.WriteLine("   does not fail immediately. It fails when the OS declines to issue");
    Console.WriteLine("   another one, and the exception surfaces as IOException at whichever");
    Console.WriteLine("   unlucky line asked for a handle next - rarely the leaking one.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. The fix. One line per resource.
// ---------------------------------------------------------------------------
static void Disposed(string workDir)
{
    Console.WriteLine("3. RIGHT - the same loop with using");
    Console.WriteLine();

    int start = CurrentHandles();
    var samples = new List<(int Written, int Handles)>();

    for (int i = 0; i < 400; i++)
    {
        using var stream = new FileStream(
            Path.Combine(workDir, $"ok-{i}.txt"),
            FileMode.Create,
            FileAccess.Write);
        using var writer = new StreamWriter(stream);

        writer.Write($"statement for customer {i}");

        if ((i + 1) % 100 == 0)
        {
            samples.Add((i + 1, CurrentHandles()));
        }
    }

    Console.WriteLine($"   handles at start : {start}");
    Console.WriteLine();
    Console.WriteLine("   files written   handles   growth");
    foreach ((int written, int handles) in samples)
    {
        Console.WriteLine($"   {written,13}   {handles,7}   {handles - start,+6}");
    }

    Console.WriteLine();
    Console.WriteLine("   Flat. Each file is closed before the next is opened, so the peak");
    Console.WriteLine("   is one handle regardless of how many customers there are.");
    Console.WriteLine();
    Console.WriteLine("   That is the property that matters: the leaking version's peak");
    Console.WriteLine("   scales with the customer count, so it was always going to fail at");
    Console.WriteLine("   SOME size. Growth found the size.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. Why it worked for two years: SafeFileHandle has a finaliser.
// ---------------------------------------------------------------------------
static void FinaliserSafetyNet(string workDir)
{
    Console.WriteLine("2. The safety net that hid the bug");
    Console.WriteLine();

    int before = CurrentHandles();

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    int after = CurrentHandles();

    Console.WriteLine($"   handles before forcing a collection : {before}");
    Console.WriteLine($"   handles after collection + finalise : {after}");
    Console.WriteLine($"   reclaimed by finalisers             : {before - after}");
    Console.WriteLine();
    Console.WriteLine("   The leaked handles came back. FileStream owns a SafeFileHandle,");
    Console.WriteLine("   and SafeHandle has a finaliser that closes the handle. So the");
    Console.WriteLine("   leak IS eventually cleaned up.");
    Console.WriteLine();
    Console.WriteLine("   That is exactly why the bug survived two years, and exactly why it");
    Console.WriteLine("   is dangerous. The cleanup happens when a garbage collection happens,");
    Console.WriteLine("   and collections are triggered by MEMORY pressure. A loop that leaks");
    Console.WriteLine("   handles while allocating almost nothing may never trigger one.");
    Console.WriteLine();
    Console.WriteLine("   The job exhausted handles before it exhausted memory. The collector");
    Console.WriteLine("   had no reason to run, so the safety net never deployed.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. The async version, which is what the rewritten job uses.
// ---------------------------------------------------------------------------
static async Task AsyncVersion(string workDir)
{
    Console.WriteLine("4. The async version");
    Console.WriteLine();

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    int start = CurrentHandles();
    var sw = Stopwatch.StartNew();

    for (int i = 0; i < 400; i++)
    {
        // await using, because DisposeAsync flushes without blocking the
        // thread. A plain using here would compile and silently block.
        await using var stream = new FileStream(
            Path.Combine(workDir, $"async-{i}.txt"),
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 4096,
            useAsync: true);

        await using var writer = new StreamWriter(stream);
        await writer.WriteAsync($"statement for customer {i}");
    }

    sw.Stop();

    Console.WriteLine($"   400 files written in {sw.Elapsed.TotalMilliseconds:F0} ms");
    Console.WriteLine($"   handle growth       : {CurrentHandles() - start:+#;-#;0}");
    Console.WriteLine();
    Console.WriteLine("   Note useAsync: true on the FileStream. Without it the async");
    Console.WriteLine("   methods still work but perform synchronous I/O on a pool thread,");
    Console.WriteLine("   which is the blocking behaviour await was meant to avoid.");
    Console.WriteLine();
}

static void Verdict()
{
    Console.WriteLine("5. What to take from this");
    Console.WriteLine();
    Console.WriteLine("   The finaliser is a safety net, and a safety net you rely on is a");
    Console.WriteLine("   bug. It fires on the collector's schedule, which is driven by");
    Console.WriteLine("   memory, and handles are not memory.");
    Console.WriteLine();
    Console.WriteLine("   Three rules the measurements support:");
    Console.WriteLine("     1. Every IDisposable gets a using. No exceptions to reason about.");
    Console.WriteLine("     2. If a type offers DisposeAsync, await the using.");
    Console.WriteLine("     3. Watch handle count in production, not only memory. A leak");
    Console.WriteLine("        that never triggers a collection is invisible on a memory graph.");
}

static int CurrentHandles()
{
    using var process = Process.GetCurrentProcess();
    process.Refresh();
    return process.HandleCount;
}
