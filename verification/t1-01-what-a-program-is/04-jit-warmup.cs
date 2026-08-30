// Demo 4 — the JIT is measurable, not folklore. Run with:
//   dotnet run -c Release 04-jit-warmup.cs
//
// This measures the cost of compiling a method the first time it is called.
// For the separate question of what tiered compilation costs and saves, see
// 05-tiering-workload.cs, which has to be measured at the process level.
using System.Diagnostics;
using System.Runtime;

Console.WriteLine($"methods JIT-compiled before this line : {JitInfo.GetCompiledMethodCount():N0}");
Console.WriteLine($"time already spent inside the JIT     : {JitInfo.GetCompilationTime().TotalMilliseconds:F1} ms");
Console.WriteLine();

int[] data = new int[20_000];
for (int i = 0; i < data.Length; i++)
{
    data[i] = i;
}

long before = JitInfo.GetCompiledMethodCount();
long start = Stopwatch.GetTimestamp();
long result = Checksum(data);
TimeSpan firstCall = Stopwatch.GetElapsedTime(start);
long compiled = JitInfo.GetCompiledMethodCount() - before;

start = Stopwatch.GetTimestamp();
result += Checksum(data);
TimeSpan secondCall = Stopwatch.GetElapsedTime(start);

Console.WriteLine($"1st call : {firstCall.TotalMicroseconds,8:N1} us  (compiled {compiled} method(s) on the way)");
Console.WriteLine($"2nd call : {secondCall.TotalMicroseconds,8:N1} us  (already compiled)");
Console.WriteLine($"the first call cost {firstCall.TotalMicroseconds / secondCall.TotalMicroseconds:F0}x the second");
Console.WriteLine();

Console.WriteLine("Checksum contains a long loop, so on-stack replacement (OSR) promoted it");
Console.WriteLine("to optimised code DURING the first call. That is why the second call is");
Console.WriteLine("already at full speed, and why calling it another 200 times changes");
Console.WriteLine("nothing measurable.");
Console.WriteLine();

Console.WriteLine($"methods JIT-compiled in total         : {JitInfo.GetCompiledMethodCount():N0}");
Console.WriteLine($"total time spent inside the JIT       : {JitInfo.GetCompilationTime().TotalMilliseconds:F1} ms");

// Printed so the work above cannot be deleted as unused.
Console.WriteLine($"(checksum {result})");

static long Checksum(int[] values)
{
    long total = 0;
    for (int i = 0; i < values.Length; i++)
    {
        total += values[i] * 31L;
    }
    return total;
}
