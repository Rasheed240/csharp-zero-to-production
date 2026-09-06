// 00-smallest.cs — Paging a list of payments, the way everybody writes it
// first, and the two things that are already wrong.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every count and identifier here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// Stands in for a table. Fifty payments, newest first.
var payments = Enumerable.Range(1, 50)
    .Select(n => new Payment($"PAY-{n:000}", 1_000L * n, new DateTime(2026, 1, 1).AddMinutes(n)))
    .OrderByDescending(p => p.CreatedAt)
    .ToList();

var app = builder.Build();

// The version everybody writes first.
app.MapGet("/v1/payments", (int page = 1, int pageSize = 10) => Results.Ok(new
{
    page,
    pageSize,
    total = payments.Count,
    items = payments.Skip((page - 1) * pageSize).Take(pageSize).Select(p => p.Id)
}));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("Paging fifty payments, ten at a time");
Console.WriteLine();

foreach (int page in new[] { 1, 2, 5 })
{
    Console.WriteLine($"   ?page={page}   {await http.GetStringAsync($"/v1/payments?page={page}")}");
}

Console.WriteLine();
Console.WriteLine("   That works, and it is what almost every API does. Two things about it");
Console.WriteLine("   are already wrong, and neither shows up in a test.");
Console.WriteLine();

// The first: the caller decides how much work the server does.
using HttpResponseMessage huge = await http.GetAsync("/v1/payments?page=1&pageSize=1000000");
PageResult? result = await huge.Content.ReadFromJsonAsync<PageResult>();

Console.WriteLine($"   ?pageSize=1000000   {(int)huge.StatusCode}, {result?.Items.Count} items returned");
Console.WriteLine();
Console.WriteLine("   THE CALLER DECIDES HOW MUCH WORK YOU DO. Nothing rejected a page size of");
Console.WriteLine("   a million, so a single request can ask for the whole table. Against a");
Console.WriteLine("   real database that is one query holding one connection while it reads");
Console.WriteLine("   everything, and a client can send fifty of them at once.");
Console.WriteLine();

// The second: what happens when the data changes between two requests.
Console.WriteLine("   And the second, which is the subject of the next file:");
Console.WriteLine();

var firstPage = (await http.GetFromJsonAsync<PageResult>("/v1/payments?page=1&pageSize=10"))!;

// One new payment arrives, as one does.
payments.Insert(0, new Payment("PAY-051", 51_000L, new DateTime(2026, 1, 1).AddMinutes(51)));

var secondPage = (await http.GetFromJsonAsync<PageResult>("/v1/payments?page=2&pageSize=10"))!;

await app.StopAsync();

Console.WriteLine($"   page 1, before the insert   {string.Join(" ", firstPage.Items)}");
Console.WriteLine($"   page 2, after the insert    {string.Join(" ", secondPage.Items)}");
Console.WriteLine();

string[] seen = [.. firstPage.Items, .. secondPage.Items];

Console.WriteLine($"   rows the caller has seen    {seen.Length}");
Console.WriteLine($"   distinct rows               {seen.Distinct().Count()}");
Console.WriteLine($"   duplicated                  {string.Join(" ", seen.GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key))}");
Console.WriteLine();
Console.WriteLine("   THE CALLER SAW ONE ROW TWICE, and has no way to know. A row inserted at");
Console.WriteLine("   the front shifted everything down by one, so the row that was last on");
Console.WriteLine("   page 1 is now first on page 2.");
Console.WriteLine();
Console.WriteLine("   Nothing failed. The requests were correct, the responses were correct,");
Console.WriteLine("   and the client's list of payments has a duplicate in it.");
Console.WriteLine();
Console.WriteLine("   THOSE TWO PROBLEMS ARE THE WHOLE MODULE:");
Console.WriteLine();
Console.WriteLine("     - a page is a request to the database, and the caller must not be the");
Console.WriteLine("       one who decides how expensive it is;");
Console.WriteLine();
Console.WriteLine("     - a page number is a position in a list that is still changing, and a");
Console.WriteLine("       position is not an identity.");

// ---------------------------------------------------------------------------
record Payment(string Id, long AmountMinor, DateTime CreatedAt);

record PageResult(int Page, int PageSize, int Total, List<string> Items);
