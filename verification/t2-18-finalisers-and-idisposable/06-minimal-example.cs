// 06-minimal-example.cs — Dispose is deterministic. Finalisation is not. Nothing
// calls Dispose for you.
//
// Run:  dotnet run 06-minimal-example.cs -c Release

Console.WriteLine("With using:");
using (var a = new Resource("A"))
{
    Console.WriteLine("  ...work...");
}
Console.WriteLine("  (disposed at the closing brace, every time, guaranteed)");
Console.WriteLine();

Console.WriteLine("Without using:");
Abandon();
Console.WriteLine("  ...work...");
Console.WriteLine($"  disposals so far: {Resource.Disposals}, finalisers so far: {Resource.Finalisers}");
Console.WriteLine();

Console.WriteLine("After forcing a collection:");
GC.Collect();
GC.WaitForPendingFinalizers();
Console.WriteLine($"  disposals: {Resource.Disposals}, finalisers: {Resource.Finalisers}");
Console.WriteLine();

Console.WriteLine("Dispose ran once, for the object in the using block.");
Console.WriteLine("The abandoned object was never disposed - only finalised, and only");
Console.WriteLine("because a collection happened to run. Nothing in the runtime calls");
Console.WriteLine("Dispose for you.");

static void Abandon()
{
    var b = new Resource("B");
}

sealed class Resource : IDisposable
{
    public static int Disposals;
    public static int Finalisers;

    private readonly string _name;
    private bool _disposed;

    public Resource(string name) => _name = name;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Interlocked.Increment(ref Disposals);
        Console.WriteLine($"  Dispose ran for {_name}");

        // Without this, the object still pays for an extra collection.
        GC.SuppressFinalize(this);
    }

    ~Resource() => Interlocked.Increment(ref Finalisers);
}
