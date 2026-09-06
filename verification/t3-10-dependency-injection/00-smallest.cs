// 00-smallest.cs — The same class written two ways, and the one thing that
// changes: who decides what it talks to.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

Console.WriteLine("1. The version that decides for itself");
Console.WriteLine();

var hardwired = new HardwiredReceiptWriter();
Console.WriteLine($"   {hardwired.Write("INV-1", 125_00)}");

Console.WriteLine();
Console.WriteLine("   To test that line you need a real clock, so the expected value changes");
Console.WriteLine("   every second. To use a different clock you edit the class.");
Console.WriteLine();

Console.WriteLine("2. The version that is told");
Console.WriteLine();

// The dependency is a constructor argument, so the caller chooses it.
var injected = new ReceiptWriter(new SystemClock());
Console.WriteLine($"   with the real clock   {injected.Write("INV-1", 125_00)}");

var tested = new ReceiptWriter(new FixedClock(new DateTime(2026, 1, 1, 9, 0, 0)));
Console.WriteLine($"   with a fixed clock    {tested.Write("INV-1", 125_00)}");

Console.WriteLine();
Console.WriteLine("   The second line is an assertion you can write. Nothing about");
Console.WriteLine("   ReceiptWriter changed between them.");
Console.WriteLine();

Console.WriteLine("3. The same class, wired by the container");
Console.WriteLine();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// Two registrations: what to hand out when somebody asks for each type.
builder.Services.AddSingleton<IClock, SystemClock>();
builder.Services.AddSingleton<ReceiptWriter>();

var app = builder.Build();

// Nobody writes "new ReceiptWriter(new SystemClock())" anywhere. The parameter
// is a request, and the container answers it.
app.MapGet("/receipts/{id}", (string id, ReceiptWriter writer) =>
    Results.Ok(new { receipt = writer.Write(id, 125_00) }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
Console.WriteLine($"   GET /receipts/INV-1   {await http.GetStringAsync("/receipts/INV-1")}");
await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   THE WHOLE IDEA IN ONE SENTENCE: a class states what it needs, and");
Console.WriteLine("   something else decides what to give it.");
Console.WriteLine();
Console.WriteLine("   That 'something else' is one place in the program rather than every");
Console.WriteLine("   place a dependency is used, which is what makes swapping a clock, a");
Console.WriteLine("   gateway or a database a change to one line.");

// ---------------------------------------------------------------------------
public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public sealed class FixedClock(DateTime fixedTime) : IClock
{
    public DateTime UtcNow => fixedTime;
}

// Decides for itself. There is no seam: no caller can change what it talks to.
public sealed class HardwiredReceiptWriter
{
    public string Write(string reference, long amountMinor) =>
        $"{reference} {amountMinor / 100m:0.00} at {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}";
}

// Is told. The dependency is visible in the signature, so the compiler will not
// let you construct one without deciding.
public sealed class ReceiptWriter(IClock clock)
{
    public string Write(string reference, long amountMinor) =>
        $"{reference} {amountMinor / 100m:0.00} at {clock.UtcNow:yyyy-MM-dd HH:mm:ss}";
}
