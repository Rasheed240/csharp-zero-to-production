// 00-smallest.cs — Attributes on a type, one line to make them run.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// THE ONE LINE. Without it the attributes below are decoration.
builder.Services.AddValidation();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseStatusCodePages();

app.MapPost("/payments", (CreatePayment body) =>
    Results.Ok(new { accepted = body.AmountMinor }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (string json in new[]
{
    """{"amountMinor":123450,"currency":"GBP"}""",
    """{"amountMinor":-5,"currency":"POUNDS"}"""
})
{
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using HttpResponseMessage response = await http.PostAsync("/payments", content);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"POST {json}");
    Console.WriteLine($"  -> {(int)response.StatusCode} {(body.Length > 150 ? body[..150] + "..." : body)}");
    Console.WriteLine();
}

Console.WriteLine("The attributes are on the type. AddValidation() is what reads them.");
Console.WriteLine("Remove that one line and the second request returns 200.");

await app.StopAsync();

// ---------------------------------------------------------------------------
public sealed class CreatePayment
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}
