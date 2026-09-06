// 00-smallest.cs — The smallest pipeline that shows a request going in and
// coming back out.
//
// Run:  dotnet run 00-smallest.cs -c Release

#:sdk Microsoft.NET.Sdk.Web

var log = new List<string>();

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// Each Use adds one link to a chain. The lambda receives the context and a
// delegate that runs everything registered AFTER it.
app.Use(async (context, next) =>
{
    log.Add("A: on the way in");
    await next();                   // hand control to the rest of the pipeline
    log.Add("A: on the way out");
});

app.Use(async (context, next) =>
{
    log.Add("B: on the way in");
    await next();
    log.Add("B: on the way out");
});

app.MapGet("/", () =>
{
    log.Add("the endpoint");
    return "ok";
});

await app.StartAsync();

using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
string body = await http.GetStringAsync("/");

Console.WriteLine($"the response body: {body}");
Console.WriteLine();
Console.WriteLine("what ran, in order:");
foreach (string line in log)
{
    Console.WriteLine($"   {line}");
}

Console.WriteLine();
Console.WriteLine("A wraps B, and B wraps the endpoint. The first registered");
Console.WriteLine("middleware sees the request FIRST and the response LAST.");
Console.WriteLine();
Console.WriteLine("That is the whole model: the pipeline is nested, not sequential.");

await app.StopAsync();
