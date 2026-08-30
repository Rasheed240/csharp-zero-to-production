// Demo 5 — a fixed workload used to measure what tiered compilation costs and
// saves. Tiering is a process-level trade-off, so it has to be measured by
// running the whole process under different settings rather than from inside.
//
//   dotnet build -c Release 05-tiering-workload.cs
//
// then run the produced executable with, for example:
//   DOTNET_TieredCompilation=1   (the default: fast start, slower first code)
//   DOTNET_TieredCompilation=0   (compile everything optimised up front)
//   DOTNET_TieredPGO=0           (default is 1 on .NET 8+)
//
// See run-tiering-comparison.sh in this folder for the harness.
using System.Diagnostics;
using System.Runtime;

long processStart = Stopwatch.GetTimestamp();

int[] data = new int[50_000];
for (int i = 0; i < data.Length; i++)
{
    data[i] = i % 977;
}

// Enough distinct work to force a realistic number of methods to be compiled.
long total = 0;
for (int round = 0; round < 60; round++)
{
    total += Checksum(data);
    total += Weighted(data, round);
    total += Bucketed(data, 16);
}

TimeSpan elapsed = Stopwatch.GetElapsedTime(processStart);

string tiered = Environment.GetEnvironmentVariable("DOTNET_TieredCompilation") ?? "(default)";
string pgo = Environment.GetEnvironmentVariable("DOTNET_TieredPGO") ?? "(default)";

Console.WriteLine(
    $"TieredCompilation={tiered,-9} TieredPGO={pgo,-9} " +
    $"work={elapsed.TotalMilliseconds,7:F1} ms  " +
    $"jit={JitInfo.GetCompilationTime().TotalMilliseconds,6:F1} ms  " +
    $"methods={JitInfo.GetCompiledMethodCount(),4}  " +
    $"(checksum {total})");

static long Checksum(int[] values)
{
    long sum = 0;
    for (int i = 0; i < values.Length; i++)
    {
        sum += values[i] * 31L;
    }
    return sum;
}

static long Weighted(int[] values, int round)
{
    long sum = 0;
    for (int i = 0; i < values.Length; i++)
    {
        sum += (values[i] ^ round) * 7L - (values[i] >> 3);
    }
    return sum;
}

static long Bucketed(int[] values, int buckets)
{
    Span<long> counts = stackalloc long[buckets];
    for (int i = 0; i < values.Length; i++)
    {
        counts[values[i] % buckets] += values[i];
    }

    long sum = 0;
    for (int i = 0; i < buckets; i++)
    {
        sum += counts[i];
    }
    return sum;
}
