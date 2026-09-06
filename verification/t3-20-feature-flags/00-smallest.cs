// 00-smallest.cs — The `if` everybody writes, and the four things it decided.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every count and value here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The flag, as it is usually introduced: a configuration key read where it is
// needed.
((IConfigurationBuilder)builder.Configuration).AddInMemoryCollection(new Dictionary<string, string?>
{
    ["Features:NewCheckout"] = "true"
});

var app = builder.Build();

int reads = 0;

app.MapPost("/v1/checkout", (IConfiguration configuration, HttpContext context) =>
{
    // The line everybody writes.
    reads++;

    if (configuration.GetValue<bool>("Features:NewCheckout"))
    {
        return Results.Ok(new { path = "new", total = 4999 });
    }

    return Results.Ok(new { path = "old", total = 4999 });
});

// The same flag, read again somewhere else in the same request's work.
app.MapPost("/v1/checkout-two-reads", (IConfiguration configuration) =>
{
    reads++;
    bool first = configuration.GetValue<bool>("Features:NewCheckout");

    reads++;
    bool second = configuration.GetValue<bool>("Features:NewCheckout");

    return Results.Ok(new { first, second, agreed = first == second });
});

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("A feature flag, the way it usually starts");
Console.WriteLine();

Console.WriteLine($"   POST /v1/checkout   {await Post(http, "/v1/checkout")}");
Console.WriteLine();

// 1. Where the value comes from, and what happens when it is not there.
Console.WriteLine("   FOUR THINGS THAT LINE HAS ALREADY DECIDED:");
Console.WriteLine();
Console.WriteLine("   1. WHAT HAPPENS WHEN THE KEY IS MISSING");
Console.WriteLine();

IConfiguration empty = new ConfigurationBuilder().Build();

Console.WriteLine($"     GetValue<bool>(\"Features:NewCheckout\") with no key   " +
    $"{empty.GetValue<bool>("Features:NewCheckout")}");
Console.WriteLine($"     GetValue<bool>(\"Features:Anything\") with no key      " +
    $"{empty.GetValue<bool>("Features:Anything")}");

Console.WriteLine();
Console.WriteLine("     A MISSING FLAG IS FALSE, silently, with no error anywhere. That is");
Console.WriteLine("     the right default for a new feature and the wrong one for a kill");
Console.WriteLine("     switch: delete the key from a config file during a tidy-up and the");
Console.WriteLine("     safety mechanism turns itself off.");
Console.WriteLine();

// 2. What a typo does.
Console.WriteLine("   2. WHAT A TYPO DOES");
Console.WriteLine();

IConfiguration typo = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?> { ["Features:NewChekout"] = "true" })
    .Build();

Console.WriteLine($"     config has 'NewChekout', code asks for 'NewCheckout'   " +
    $"{typo.GetValue<bool>("Features:NewCheckout")}");
Console.WriteLine();
Console.WriteLine("     THE SAME ANSWER AS 'DELIBERATELY OFF'. A string key means the compiler");
Console.WriteLine("     cannot help, and the failure is indistinguishable from the flag");
Console.WriteLine("     working. Nobody notices, because the feature not appearing is exactly");
Console.WriteLine("     what an unflipped flag looks like.");
Console.WriteLine();

// 3. How many times it is read, and whether the answers agree.
Console.WriteLine("   3. HOW OFTEN IT IS READ");
Console.WriteLine();

reads = 0;

for (int i = 0; i < 10; i++)
{
    await Post(http, "/v1/checkout");
}

Console.WriteLine($"     10 requests read the flag {reads} times");
Console.WriteLine($"     one request that reads it twice   {await Post(http, "/v1/checkout-two-reads")}");
Console.WriteLine();
Console.WriteLine("     THOSE TWO READS AGREED, AND NOTHING GUARANTEES THAT THEY WILL. The");
Console.WriteLine("     value comes from configuration, configuration can reload, and there is");
Console.WriteLine("     no scope in which a flag's value is fixed. A request that reads a flag");
Console.WriteLine("     in three places can take the new path in one and the old path in");
Console.WriteLine("     another - which is the incident in this module.");
Console.WriteLine();

// 4. Who it applies to.
Console.WriteLine("   4. WHO IT APPLIES TO");
Console.WriteLine();
Console.WriteLine("     Everyone, at once, or nobody. There is no user in that expression, so");
Console.WriteLine("     there is no way to enable the feature for one customer, for staff, for");
Console.WriteLine("     five percent, or for everyone except the account that reported a bug.");
Console.WriteLine();
Console.WriteLine("     THAT IS THE DIFFERENCE BETWEEN A FLAG AND A DEPLOYMENT. A boolean read");
Console.WriteLine("     from configuration is a deployment you can perform without a deploy.");
Console.WriteLine("     Useful, and much less than what people mean by feature flags.");
Console.WriteLine();

await app.StopAsync();

Console.WriteLine("   AND ONE THING IT DID NOT DECIDE, WHICH COSTS MORE THAN ALL FOUR:");
Console.WriteLine();
Console.WriteLine("     NOTHING SAYS WHEN THIS FLAG GOES AWAY. Both code paths now exist");
Console.WriteLine("     forever by default. Every test, every refactor and every future");
Console.WriteLine("     feature has to consider both, and the branch nobody exercises rots");
Console.WriteLine("     quietly until somebody flips the flag two years later and finds out.");
Console.WriteLine();
Console.WriteLine("   NONE OF THIS MAKES THE LINE WRONG. It makes it a decision about your");
Console.WriteLine("   configuration system rather than a feature flag, and the gap between");
Console.WriteLine("   those two is what the rest of this module is about.");

// ---------------------------------------------------------------------------
static async Task<string> Post(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.PostAsync(path, null);

    return await response.Content.ReadAsStringAsync();
}
