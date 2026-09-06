// 05-minimal-example.cs — the smallest program that shows cancellation being
// cooperative: the same work, once ignoring the token and once honouring it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static async Task Main()
    {
        await Run("ignores the token", IgnoresAsync);
        await Run("honours the token", HonoursAsync);
    }

    static async Task Run(string label, Func<CancellationToken, Task> work)
    {
        using var cts = new CancellationTokenSource();
        cts.CancelAfter(50);                       // give up after 50 ms

        var sw = Stopwatch.StartNew();
        try
        {
            await work(cts.Token);
            Console.WriteLine($"{label,-20}: ran to completion in {sw.ElapsedMilliseconds} ms");
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine($"{label,-20}: stopped after {sw.ElapsedMilliseconds} ms");
        }
    }

    // The token is accepted and never used, so nothing can stop this.
    static async Task IgnoresAsync(CancellationToken ct)
    {
        for (var i = 0; i < 10; i++)
            await Task.Delay(30).ConfigureAwait(false);
    }

    // The token reaches the awaited call, so cancellation takes effect.
    static async Task HonoursAsync(CancellationToken ct)
    {
        for (var i = 0; i < 10; i++)
            await Task.Delay(30, ct).ConfigureAwait(false);
    }
}
