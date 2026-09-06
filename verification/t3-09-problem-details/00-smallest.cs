// 00-smallest.cs — The same four failures, with and without an error contract.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The two lines. AddProblemDetails registers the writer; UseStatusCodePages is
// what invokes it for a response that has a status and no body.
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseStatusCodePages();

app.MapGet("/ok", () => Results.Ok(new { status = "fine" }));
app.MapGet("/missing", () => Results.NotFound());
app.MapGet("/forbidden", () => Results.StatusCode(403));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (string path in new[] { "/ok", "/missing", "/forbidden", "/no-such-route" })
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"GET {path,-16} {(int)response.StatusCode}  " +
        $"{response.Content.Headers.ContentType?.MediaType ?? "(no type)"}");
    Console.WriteLine($"    {(body.Length == 0 ? "(empty body)" : body)}");
    Console.WriteLine();
}

Console.WriteLine("Every failure has the same shape, and it is a shape with a name:");
Console.WriteLine("RFC 9457, served as application/problem+json.");
Console.WriteLine();
Console.WriteLine("Remove UseStatusCodePages and all three failures return empty bodies.");

await app.StopAsync();
