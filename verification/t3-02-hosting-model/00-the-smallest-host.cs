// 00-the-smallest-host.cs — The whole hosting model in five lines, with a
// print from each phase so the order is visible rather than assumed.
//
// Run:  dotnet run 00-the-smallest-host.cs -c Release

#:sdk Microsoft.NET.Sdk.Web

// 1. The BUILDER. Configuration, logging and a list of service registrations.
//    Nothing is running and nothing has been constructed.
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
Console.WriteLine("1. builder created - nothing is running yet");

// 2. REGISTRATION. Adding to that list. Still nothing constructed.
builder.Services.AddSingleton<Greeter>();
Console.WriteLine("2. Greeter registered - but not constructed");

// 3. BUILD. The registrations are frozen and the container is created.
var app = builder.Build();
Console.WriteLine("3. Build() done - the container exists, the server does not");

// 4. THE PIPELINE. What happens to a request. Still nothing is listening.
app.MapGet("/", (Greeter greeter) => greeter.Greet());
Console.WriteLine("4. endpoint mapped - still not listening");

// 5. START. Now the server listens. In a real program this is app.Run(),
//    which starts and then blocks until shutdown; StartAsync is the same
//    thing without the blocking, so the rest of this file can run.
await app.StartAsync();
Console.WriteLine($"5. listening on {app.Urls.First()}");

using var http = new HttpClient();
Console.WriteLine($"   a request returns: {await http.GetStringAsync(app.Urls.First())}");

await app.StopAsync();
Console.WriteLine("6. stopped");

sealed class Greeter
{
    public Greeter() => Console.WriteLine("   (Greeter constructed - on first use, during the request)");

    public string Greet() => "hello";
}
