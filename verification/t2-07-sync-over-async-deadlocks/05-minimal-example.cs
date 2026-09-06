// 05-minimal-example.cs — the smallest program showing the constructor problem
// and the factory that solves it.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Threading;
using System.Threading.Tasks;

// A constructor cannot be async, so this one blocks. It compiles and it runs.
// It is also the single most common sync-over-async bug in .NET services.
sealed class BlockingVersion
{
    public int Value { get; }
    public BlockingVersion() => Value = LoadAsync().GetAwaiter().GetResult();
    static async Task<int> LoadAsync() { await Task.Delay(50); return 42; }
}

// The fix: a private constructor that takes finished data, and a static async
// factory that does the awaiting.
sealed class FactoryVersion
{
    public int Value { get; }
    private FactoryVersion(int value) => Value = value;

    public static async Task<FactoryVersion> CreateAsync(CancellationToken ct = default)
    {
        var value = await LoadAsync(ct).ConfigureAwait(false);
        return new FactoryVersion(value);
    }

    static async Task<int> LoadAsync(CancellationToken ct)
    {
        await Task.Delay(50, ct).ConfigureAwait(false);
        return 42;
    }
}

class Program
{
    static async Task Main()      // async Main has been legal since C# 7.1
    {
        var blocking = new BlockingVersion();
        Console.WriteLine($"blocking ctor : {blocking.Value}  (held a thread for 50 ms)");

        var built = await FactoryVersion.CreateAsync();
        Console.WriteLine($"async factory : {built.Value}  (held no thread at all)");
    }
}
