// 05-datas.cs — DATAS: Dynamic Adaptation To Application Sizes, on by default
// with server GC from .NET 9.
//
// Run:  dotnet run 05-datas.cs -c Release
//
// This file measures itself twice. The parent process re-launches the ALREADY
// BUILT executable (Environment.ProcessPath) with DOTNET_GCDynamicAdaptationMode
// set to 1 and then to 0, so both measurements come from identical code and
// there is no second build to go stale.
//
// EXACT vs RATIO: gen 2 collection counts were identical on every run observed
// (6 with DATAS, 2 without). Memory figures are ratios; the absolute megabytes
// depend on the machine.

#:property ServerGarbageCollection=true

using System.Diagnostics;
using System.Runtime;

const string ModeVariable = "DOTNET_GCDynamicAdaptationMode";
const string ChildMarker = "T2_17_DATAS_CHILD";

if (Environment.GetEnvironmentVariable(ChildMarker) == "1")
{
    RunWorkloadAndReport();
    return;
}

Console.WriteLine("DATAS: what the adaptive heap sizing actually trades");
Console.WriteLine();
Console.WriteLine($"   parent server GC : {GCSettings.IsServerGC}");
Console.WriteLine($"   executable       : {Path.GetFileName(Environment.ProcessPath ?? "unknown")}");
Console.WriteLine();
Console.WriteLine("   DATAS   working set   committed    gen0   gen1   gen2");
Console.WriteLine("   -----   -----------   ---------    ----   ----   ----");

var results = new List<(string Mode, double WorkingSet, double Committed)>();

foreach (string mode in new[] { "1", "0" })
{
    string? line = RunChild(mode);
    if (line is null)
    {
        Console.WriteLine($"   {mode,5}   (child did not report)");
        continue;
    }

    // The child prints a single tab-separated line so the parent does not have
    // to parse prose.
    string[] f = line.Split('\t');
    double ws = double.Parse(f[0]);
    double committed = double.Parse(f[1]);
    results.Add((mode, ws, committed));

    Console.WriteLine($"   {(mode == "1" ? "  on" : " off"),5}   {ws,8:F1} MB   {committed,6:F1} MB    {f[2],4}   {f[3],4}   {f[4],4}");
}

Console.WriteLine();

if (results.Count == 2)
{
    var on = results[0];
    var off = results[1];
    Console.WriteLine($"   DATAS off uses {off.WorkingSet / on.WorkingSet:F1}x the working set " +
        $"({off.WorkingSet - on.WorkingSet:F0} MB more)");
    Console.WriteLine($"   DATAS off commits {off.Committed / on.Committed:F1}x the memory");
    Console.WriteLine();
}

Console.WriteLine("   The trade, stated plainly:");
Console.WriteLine("     DATAS on  - smaller heap, MORE frequent collections.");
Console.WriteLine("     DATAS off - larger heap, FEWER collections, more throughput.");
Console.WriteLine();
Console.WriteLine("   On a container with a memory limit, DATAS is the difference between");
Console.WriteLine("   running and being killed by the OOM killer. On a dedicated box that");
Console.WriteLine("   needs raw throughput, it costs you.");
Console.WriteLine();
Console.WriteLine("   A gotcha worth keeping: there is NO MSBuild property for this. Setting");
Console.WriteLine("   #:property GCDynamicAdaptationMode=false is silently ignored - verified,");
Console.WriteLine("   it changed nothing. The knob is the runtimeconfig entry");
Console.WriteLine("   System.GC.DynamicAdaptationMode or the environment variable used here.");
Console.WriteLine();
Console.WriteLine($"   AppContext.TryGetSwitch(\"System.GC.DynamicAdaptationMode\") readable: " +
    $"{AppContext.TryGetSwitch("System.GC.DynamicAdaptationMode", out _)}");
Console.WriteLine("   It is not exposed as an AppContext switch, so a process cannot report");
Console.WriteLine("   its own DATAS setting. Read GC Heap Count from dotnet-counters instead.");

// ---------------------------------------------------------------------------

static string? RunChild(string datasMode)
{
    string? exe = Environment.ProcessPath;
    if (exe is null)
    {
        return null;
    }

    var psi = new ProcessStartInfo(exe)
    {
        RedirectStandardOutput = true,
        UseShellExecute = false
    };
    psi.Environment[ModeVariable] = datasMode;
    psi.Environment[ChildMarker] = "1";

    using var child = Process.Start(psi);
    if (child is null)
    {
        return null;
    }

    string output = child.StandardOutput.ReadToEnd();
    child.WaitForExit();
    return output.Trim().Length == 0 ? null : output.Trim();
}

static void RunWorkloadAndReport()
{
    // A rolling window of survivors, so the heap has a genuine live set the
    // collector has to size itself around.
    var window = new object[200_000];
    for (int i = 0; i < 3_000_000; i++)
    {
        var block = new byte[64];
        block[0] = (byte)i;
        if (i % 15 == 0)
        {
            window[i / 15 % window.Length] = block;
        }
    }

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    var info = GC.GetGCMemoryInfo();
    double ws = Process.GetCurrentProcess().WorkingSet64 / 1024.0 / 1024.0;
    double committed = info.TotalCommittedBytes / 1024.0 / 1024.0;

    Console.Write($"{ws:F1}\t{committed:F1}\t{GC.CollectionCount(0)}\t{GC.CollectionCount(1)}\t{GC.CollectionCount(2)}");
    GC.KeepAlive(window);
}
