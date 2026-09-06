// 00-smallest.cs — Two versions of one endpoint, and the thing versioning is
// actually for: changing a response without changing it for anybody.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every status code and field name here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// v1, written eighteen months ago. Two clients still use it and one of them is
// a mobile application nobody can force to upgrade.
RouteGroupBuilder v1 = app.MapGroup("/v1");

v1.MapGet("/payments/{id}", (string id) => Results.Ok(new
{
    id,
    amount = 500.00m,
    currency = "GBP"
}));

// v2. The amount moves to minor units, because 500.00 as a decimal was causing
// rounding arguments with the reconciliation team.
RouteGroupBuilder v2 = app.MapGroup("/v2");

v2.MapGet("/payments/{id}", (string id) => Results.Ok(new
{
    id,
    amountMinor = 50_000L,
    currency = "GBP",
    status = "captured"
}));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("The same payment, two versions");
Console.WriteLine();
Console.WriteLine($"   GET /v1/payments/PAY-1   {await http.GetStringAsync("/v1/payments/PAY-1")}");
Console.WriteLine($"   GET /v2/payments/PAY-1   {await http.GetStringAsync("/v2/payments/PAY-1")}");
Console.WriteLine();

using HttpResponseMessage unversioned = await http.GetAsync("/payments/PAY-1");

Console.WriteLine($"   GET /payments/PAY-1      {(int)unversioned.StatusCode}");
Console.WriteLine();

await app.StopAsync();

Console.WriteLine("   WHAT VERSIONING IS FOR, in one sentence: MAKING A CHANGE THAT WOULD");
Console.WriteLine("   BREAK AN EXISTING CLIENT, WITHOUT BREAKING IT.");
Console.WriteLine();
Console.WriteLine("   The change here is a breaking one and there is no way to make it not be.");
Console.WriteLine("   'amount' became 'amountMinor', a decimal became an integer, and the units");
Console.WriteLine("   changed by a factor of a hundred. Any client reading 'amount' gets");
Console.WriteLine("   nothing; any client that guesses gets a number a hundred times too");
Console.WriteLine("   large.");
Console.WriteLine();
Console.WriteLine("   Two versions running side by side is what lets that change ship on");
Console.WriteLine("   Tuesday while the mobile application keeps working until its users");
Console.WriteLine("   upgrade, which for some of them is never.");
Console.WriteLine();
Console.WriteLine("   NOTICE THE THIRD LINE. An unversioned path is a 404, because nothing is");
Console.WriteLine("   mapped there - which is a decision, and the next file is about which");
Console.WriteLine("   decision to make.");
Console.WriteLine();
Console.WriteLine("   AND NOTICE WHAT VERSIONING COSTS, because it is not free and the cost is");
Console.WriteLine("   the reason most of this module is about avoiding it:");
Console.WriteLine();
Console.WriteLine("     - two endpoints to maintain, two sets of tests, two shapes to document;");
Console.WriteLine();
Console.WriteLine("     - every bug fix has to be considered for both, and every decision about");
Console.WriteLine("       whether a fix is a fix or a change;");
Console.WriteLine();
Console.WriteLine("     - the old one lives until the last client stops calling it, and you do");
Console.WriteLine("       not control when that is.");
Console.WriteLine();
Console.WriteLine("   THE CHEAPEST VERSION IS THE ONE YOU DID NOT HAVE TO CREATE. Most changes");
Console.WriteLine("   people version for are additive, and additive changes do not need a");
Console.WriteLine("   version at all - which is the subject of the file after next.");
