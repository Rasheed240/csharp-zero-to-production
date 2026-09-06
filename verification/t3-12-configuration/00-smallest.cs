// 00-smallest.cs — One setting, four sources, and the rule that decides which
// value the application actually gets.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every value here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

// A directory this program writes its own configuration files into, so the
// example is self-contained and leaves nothing behind.
string root = Directory.CreateTempSubdirectory("cfg-smallest").FullName;

File.WriteAllText(Path.Combine(root, "appsettings.json"), """
{
  "Gateway": {
    "BaseUrl": "https://gw.example/v1",
    "TimeoutSeconds": 30
  }
}
""");

File.WriteAllText(Path.Combine(root, "appsettings.Production.json"), """
{
  "Gateway": {
    "TimeoutSeconds": 5
  }
}
""");

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    EnvironmentName = "Production",
    ContentRootPath = root
});

builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// A fourth source, added last, standing in for what a container platform sets.
builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
{
    ["Gateway:BaseUrl"] = "https://gw.internal:8443"
});

Console.WriteLine("One setting, asked for by name:");
Console.WriteLine();
Console.WriteLine($"   Gateway:BaseUrl          {builder.Configuration["Gateway:BaseUrl"]}");
Console.WriteLine($"   Gateway:TimeoutSeconds   {builder.Configuration["Gateway:TimeoutSeconds"]}");
Console.WriteLine();
Console.WriteLine("   Where each value came from:");
Console.WriteLine();
Console.WriteLine("     appsettings.json              BaseUrl = https://gw.example/v1");
Console.WriteLine("                                   TimeoutSeconds = 30");
Console.WriteLine("     appsettings.Production.json   TimeoutSeconds = 5");
Console.WriteLine("     the in-memory source          BaseUrl = https://gw.internal:8443");
Console.WriteLine();
Console.WriteLine("   THE RULE IS ONE SENTENCE: THE LAST SOURCE THAT HAS A KEY WINS.");
Console.WriteLine();
Console.WriteLine("   Configuration is not a file. It is a LIST OF SOURCES read in order and");
Console.WriteLine("   flattened into one dictionary of string keys and string values, where a");
Console.WriteLine("   later source overwrites an earlier one for the keys it happens to have.");
Console.WriteLine();
Console.WriteLine("   Nothing merges at the object level. TimeoutSeconds survived from the base");
Console.WriteLine("   file not because the two Gateway objects were combined, but because the");
Console.WriteLine("   key 'Gateway:TimeoutSeconds' appears in one source and the key");
Console.WriteLine("   'Gateway:BaseUrl' in another.");
Console.WriteLine();

var app = builder.Build();

app.MapGet("/config", (IConfiguration configuration) => Results.Ok(new
{
    baseUrl = configuration["Gateway:BaseUrl"],
    timeout = configuration.GetValue<int>("Gateway:TimeoutSeconds")
}));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine($"   the same values inside the app   {await http.GetStringAsync("/config")}");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   The colon separates levels. 'Gateway:BaseUrl' is the BaseUrl key inside");
Console.WriteLine("   the Gateway section, and the nesting in the JSON file is a convenience");
Console.WriteLine("   for writing it - the configuration system itself is flat.");

Directory.Delete(root, recursive: true);
