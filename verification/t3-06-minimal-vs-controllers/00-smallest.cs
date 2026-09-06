// 00-smallest.cs — The same endpoint written both ways, in one program.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// Controllers have to be turned on. Minimal APIs do not - they are part of
// WebApplication itself.
builder.Services.AddControllers();

var app = builder.Build();

// MINIMAL API: a route and a delegate, in one expression.
app.MapGet("/minimal/payments/{id}", (string id) => new PaymentDto(id, 123450));

// CONTROLLERS: discovered by reflection from the class below.
app.MapControllers();

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (string path in new[] { "/minimal/payments/PAY-1", "/mvc/payments/PAY-1" })
{
    Console.WriteLine($"GET {path,-28} -> {await http.GetStringAsync(path)}");
}

Console.WriteLine();
Console.WriteLine("Identical responses. Everything in this module is about what");
Console.WriteLine("SURROUNDS those two lines, not about what they return.");

await app.StopAsync();

// ---------------------------------------------------------------------------
public record PaymentDto(string Id, long AmountMinor);

[ApiController]
[Route("mvc/payments")]
public sealed class PaymentsController : ControllerBase
{
    [HttpGet("{id}")]
    public PaymentDto Get(string id) => new(id, 123450);
}
