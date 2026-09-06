// 00-smallest.cs — The smallest program that configures Kestrel and shows the
// configuration taking effect.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web

using System.Net;

var builder = WebApplication.CreateBuilder();
builder.Logging.ClearProviders();

// Everything Kestrel does is configured here, before Build(). This is the
// server itself - not your pipeline, not your endpoints.
builder.WebHost.ConfigureKestrel(options =>
{
    // A request body larger than this is rejected before your code sees it.
    options.Limits.MaxRequestBodySize = 100;

    // Port 0 asks the operating system for any free port.
    options.Listen(IPAddress.Loopback, 0);
});

var app = builder.Build();

app.MapPost("/", async (HttpRequest request) =>
{
    using var reader = new StreamReader(request.Body);
    string body = await reader.ReadToEndAsync();
    return $"the handler received {body.Length} bytes";
});

await app.StartAsync();
Console.WriteLine($"listening on {app.Urls.First()}");
Console.WriteLine();

using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

foreach (int size in new[] { 50, 500 })
{
    using var content = new StringContent(new string('x', size));
    using HttpResponseMessage response = await http.PostAsync("/", content);

    Console.WriteLine($"POST a {size}-byte body -> {(int)response.StatusCode} " +
        $"{await response.Content.ReadAsStringAsync()}");
}

Console.WriteLine();
Console.WriteLine("The second request never reached the handler. Kestrel rejected it");
Console.WriteLine("while reading the body, and 413 means Content Too Large.");

await app.StopAsync();
