// 00-smallest.cs — The three lifetimes, counted. Two requests, two resolves
// inside each, and one number per lifetime that says what it means.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The same class, registered three times under three interfaces. The only
// difference between them is the word in the method name.
builder.Services.AddSingleton<ISingletonCounter, Counter>();
builder.Services.AddScoped<IScopedCounter, Counter>();
builder.Services.AddTransient<ITransientCounter, Counter>();

var app = builder.Build();

app.MapGet("/ids", (
    ISingletonCounter singletonA, ISingletonCounter singletonB,
    IScopedCounter scopedA, IScopedCounter scopedB,
    ITransientCounter transientA, ITransientCounter transientB) =>
    Results.Ok(new
    {
        singleton = new[] { singletonA.Id, singletonB.Id },
        scoped = new[] { scopedA.Id, scopedB.Id },
        transient = new[] { transientA.Id, transientB.Id }
    }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("Two requests, two resolves of each lifetime inside each request");
Console.WriteLine();

for (int request = 1; request <= 2; request++)
{
    Console.WriteLine($"   request {request}   {await http.GetStringAsync("/ids")}");
}

await app.StopAsync();

Console.WriteLine();
Console.WriteLine($"   instances of Counter created in total: {Counter.Created}");
Console.WriteLine();
Console.WriteLine("   Read the numbers rather than the words:");
Console.WriteLine();
Console.WriteLine("     SINGLETON   the same id in both slots and in both requests.");
Console.WriteLine("                 One instance for the life of the application.");
Console.WriteLine();
Console.WriteLine("     SCOPED      the same id in both slots, a different id in the second");
Console.WriteLine("                 request. One instance per scope, and in a web application");
Console.WriteLine("                 a scope is a request.");
Console.WriteLine();
Console.WriteLine("     TRANSIENT   a different id in every slot. A new instance every time");
Console.WriteLine("                 anybody asks, including twice in one request.");
Console.WriteLine();
Console.WriteLine("   Two requests produced 1 singleton, 2 scoped and 4 transient instances,");
Console.WriteLine("   which is 7 - and that is the whole of the mechanism.");
Console.WriteLine();
Console.WriteLine("   THE PART THAT CAUSES BUGS IS NOT THE MECHANISM. It is that a lifetime");
Console.WriteLine("   is a property of the REGISTRATION, and what actually happens depends on");
Console.WriteLine("   what holds a reference to what. That is the rest of this module.");

// ---------------------------------------------------------------------------
public interface ISingletonCounter
{
    int Id { get; }
}

public interface IScopedCounter
{
    int Id { get; }
}

public interface ITransientCounter
{
    int Id { get; }
}

// One class, three registrations. It records how many of itself exist so the
// numbers above are not an inference.
public sealed class Counter : ISingletonCounter, IScopedCounter, ITransientCounter
{
    private static int _created;

    public Counter() => Id = Interlocked.Increment(ref _created);

    public static int Created => Volatile.Read(ref _created);

    public int Id { get; }
}
