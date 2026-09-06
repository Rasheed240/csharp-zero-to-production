// 00-smallest.cs — The smallest program showing a route template capturing a
// value, and what happens when the value does not fit.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// "{id}" is a route PARAMETER. Whatever appears in that segment is captured
// and handed to the parameter of the same name.
app.MapGet("/payments/{id}", (string id) => $"looked up payment {id}");

// ":int" is a CONSTRAINT. It restricts which requests this route matches - it
// does not validate anything.
app.MapGet("/invoices/{number:int}", (int number) => $"invoice number {number}");

await app.StartAsync();
Console.WriteLine($"listening on {app.Urls.First()}");
Console.WriteLine();

using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (string path in new[] { "/payments/PAY-0001", "/invoices/42", "/invoices/abc" })
{
    HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();
    Console.WriteLine($"GET {path,-22} -> {(int)response.StatusCode} {body}");
}

Console.WriteLine();
Console.WriteLine("The last one is 404, not 400. A constraint decides whether a route");
Console.WriteLine("MATCHES; it is not validation. Nothing matched /invoices/abc, so as far");
Console.WriteLine("as the application is concerned that resource does not exist.");

await app.StopAsync();
