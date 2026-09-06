// 00-smallest.cs — Where each parameter came from, without a single attribute.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddSingleton<IClock, SystemClock>();

var app = builder.Build();

// Four parameters, four different sources, and nothing says so. The framework
// infers each one from its NAME and its TYPE.
app.MapPost("/payments/{id}", (
    string id,          // matches a route parameter -> from the ROUTE
    int retries,        // no route match, simple type -> from the QUERY
    CreatePayment body, // complex type -> from the BODY
    IClock clock)       // registered in the container -> from SERVICES
    => new
    {
        id,
        retries,
        amount = body.AmountMinor,
        clock = clock.Name
    });

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

using var content = new StringContent("""{"amountMinor": 123450}""",
    System.Text.Encoding.UTF8, "application/json");

Console.WriteLine("POST /payments/PAY-1?retries=2  body {\"amountMinor\": 123450}");
Console.WriteLine();
Console.WriteLine($"  -> {await (await http.PostAsync("/payments/PAY-1?retries=2", content))
    .Content.ReadAsStringAsync()}");
Console.WriteLine();
Console.WriteLine("Four sources, no attributes. The rules are:");
Console.WriteLine();
Console.WriteLine("  a name matching a route parameter   the route");
Console.WriteLine("  a simple type otherwise             the query string");
Console.WriteLine("  a complex type                      the body, as JSON");
Console.WriteLine("  a type registered in the container  services");
Console.WriteLine();
Console.WriteLine("Everything else in this module is what happens when a rule");
Console.WriteLine("applies and you did not expect it to.");

await app.StopAsync();

// ---------------------------------------------------------------------------
public sealed class CreatePayment
{
    public long AmountMinor { get; set; }
}

public interface IClock
{
    string Name { get; }
}

public sealed class SystemClock : IClock
{
    public string Name => "SystemClock";
}
