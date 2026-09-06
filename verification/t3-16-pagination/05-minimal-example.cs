// 05-minimal-example.cs — One list endpoint with every decision made: a cursor,
// a total order, a bounded page, an allow-list, and no count nobody asked for.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every count, cursor and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseStatusCodePages();

// Stands in for a table. 250 payments across three statuses.
var table = Enumerable.Range(1, 250)
    .Select(n => new Payment(
        $"PAY-{n:0000}",
        n % 3 == 0 ? "captured" : n % 3 == 1 ? "pending" : "failed",
        1_000L * n,
        new DateTime(2026, 1, 1).AddMinutes(n / 5)))   // five payments per minute
    .ToList();

app.MapGet("/v1/payments", (string? cursor, int? pageSize, string? status, string? sort) =>
{
    const int DefaultPageSize = 25;
    const int MaxPageSize = 100;

    // 1. THE PAGE SIZE IS BOUNDED, and out-of-range is rejected rather than
    //    clamped - a caller who asked for 500 and got 100 believes they have
    //    everything.
    int size = pageSize ?? DefaultPageSize;

    if (size < 1 || size > MaxPageSize)
    {
        return Results.Problem(
            title: $"pageSize must be between 1 and {MaxPageSize}",
            detail: $"You asked for {size}.",
            statusCode: 400);
    }

    // 2. FILTERS COME FROM AN ALLOW-LIST. An unrecognised value is a 400
    //    naming it, never an ignored filter - which would return unfiltered
    //    data to somebody who believes it was filtered.
    IEnumerable<Payment> query = table;

    if (status is not null)
    {
        if (!Allowed.Statuses.Contains(status))
        {
            return Results.Problem(
                title: "Unknown status filter",
                detail: $"'{status}' is not a status. Use: {string.Join(", ", Allowed.Statuses)}.",
                statusCode: 400);
        }

        query = query.Where(p => p.Status == status);
    }

    // 3. THE SORT FIELD COMES FROM AN ALLOW-LIST TOO, so a caller cannot
    //    order by a column no response contains.
    string sortField = sort ?? "createdAt";

    if (!Allowed.Sorts.TryGetValue(sortField, out Func<Payment, IComparable>? key))
    {
        return Results.Problem(
            title: "Unknown sort field",
            detail: $"'{sortField}' cannot be sorted on. Use: {string.Join(", ", Allowed.Sorts.Keys)}.",
            statusCode: 400);
    }

    // 4. THE ORDER IS TOTAL. The tiebreaker is the primary key, so no two
    //    rows compare equal and no plan can reorder them.
    IOrderedEnumerable<Payment> ordered = query
        .OrderByDescending(key)
        .ThenByDescending(p => p.Id, StringComparer.Ordinal);

    // 5. THE CURSOR NAMES A ROW, NOT A POSITION. Decoded and validated, not
    //    trusted - it is caller-supplied input like any other.
    if (cursor is not null)
    {
        if (!Cursor.TryDecode(cursor, out string? afterKey, out string? afterId))
        {
            return Results.Problem(
                title: "Malformed cursor",
                detail: "Send the nextCursor from a previous response, or omit it.",
                statusCode: 400);
        }

        ordered = ordered
            .Where(p =>
            {
                int compare = string.CompareOrdinal(Cursor.KeyOf(p, sortField), afterKey);

                return compare < 0
                    || (compare == 0 && string.CompareOrdinal(p.Id, afterId) < 0);
            })
            .OrderByDescending(key)
            .ThenByDescending(p => p.Id, StringComparer.Ordinal);
    }

    // 6. FETCH ONE MORE THAN ASKED FOR. That extra row answers 'is there
    //    another page' without a COUNT(*) over the whole filtered set.
    List<Payment> window = [.. ordered.Take(size + 1)];

    bool hasMore = window.Count > size;
    List<Payment> items = [.. window.Take(size)];

    return Results.Ok(new
    {
        items = items.Select(p => new { p.Id, p.Status, p.AmountMinor, p.CreatedAt }),
        hasMore,
        nextCursor = hasMore && items.Count > 0
            ? Cursor.Encode(Cursor.KeyOf(items[^1], sortField), items[^1].Id)
            : null
    });
});

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("1. Walking the whole table with a cursor");
Console.WriteLine();

var seen = new List<string>();
string? next = null;
int pages = 0;

do
{
    string url = next is null
        ? "/v1/payments?pageSize=100"
        : $"/v1/payments?pageSize=100&cursor={Uri.EscapeDataString(next)}";

    Page? page = await http.GetFromJsonAsync<Page>(url);

    seen.AddRange(page!.Items.Select(i => i.Id));
    next = page.NextCursor;
    pages++;

    Console.WriteLine($"   page {pages}   {page.Items.Count,3} items   hasMore {page.HasMore,-5}   " +
        $"first {page.Items[0].Id}   last {page.Items[^1].Id}");

    // Rows arriving mid-walk, which is what a live table does.
    table.Insert(0, new Payment($"NEW-{pages:000}", "pending", 999, new DateTime(2026, 2, 1)));
}
while (next is not null);

Console.WriteLine();
Console.WriteLine($"   rows seen        {seen.Count}");
Console.WriteLine($"   distinct         {seen.Distinct().Count()}");
Console.WriteLine($"   duplicated       {seen.Count - seen.Distinct().Count()}");
Console.WriteLine($"   of the first 250 payments, missed   " +
    $"{Enumerable.Range(1, 250).Select(n => $"PAY-{n:0000}").Except(seen).Count()}");
Console.WriteLine();
Console.WriteLine("   Three rows were inserted during the walk and none of them disturbed it.");
Console.WriteLine();

Console.WriteLine("2. What it refuses");
Console.WriteLine();
Console.WriteLine("   request                              response");
Console.WriteLine("   -------                              --------");

foreach (string query in new[]
{
    "?pageSize=25",
    "?pageSize=500",
    "?pageSize=0",
    "?status=captured",
    "?status=refunded",
    "?sort=amountMinor",
    "?sort=internalRiskScore",
    "?cursor=not-a-cursor"
})
{
    using HttpResponseMessage response = await http.GetAsync($"/v1/payments{query}");
    string body = await response.Content.ReadAsStringAsync();

    string summary = response.IsSuccessStatusCode
        ? $"200, {(await response.Content.ReadFromJsonAsync<Page>())!.Items.Count} items"
        : $"{(int)response.StatusCode}: {Title(body)}";

    Console.WriteLine($"   {query,-35}  {summary}");
}

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   Every rejection names the thing that was wrong and lists what is");
Console.WriteLine("   allowed, so a caller integrating against this fixes it once, from the");
Console.WriteLine("   response, without reading anything.");
Console.WriteLine();

Console.WriteLine("THE CHECKLIST THIS FILE IS BUILT FROM");
Console.WriteLine();
Console.WriteLine("   The caller names a ROW, not a position - a cursor, opaque, decoded and");
Console.WriteLine("     VALIDATED like any other input");
Console.WriteLine();
Console.WriteLine("   The ORDER BY ends in a unique column, always, so no plan can reorder it");
Console.WriteLine("     and no page boundary can move");
Console.WriteLine();
Console.WriteLine("   Page size has a default, a maximum and a minimum, and out-of-range is");
Console.WriteLine("     REJECTED rather than clamped");
Console.WriteLine();
Console.WriteLine("   Sortable and filterable fields come from an allow-list, so a caller");
Console.WriteLine("     cannot reach a column no response contains");
Console.WriteLine();
Console.WriteLine("   An unrecognised filter is a 400, never an ignored one");
Console.WriteLine();
Console.WriteLine("   hasMore comes from fetching pageSize + 1 rows, so no request pays for a");
Console.WriteLine("     COUNT(*) nobody asked for");
Console.WriteLine();
Console.WriteLine("   Anything a machine walks reads a CLOSED window, so no row can arrive");
Console.WriteLine("     inside it mid-walk");
Console.WriteLine();
Console.WriteLine("WHAT MAKES IT HOLD");
Console.WriteLine();
Console.WriteLine("   Two of those are correctness and the rest are consequences.");
Console.WriteLine();
Console.WriteLine("   A TOTAL ORDER means the sequence of rows is the same on every query, so");
Console.WriteLine("   'the row after this one' is a question with one answer. Without it, every");
Console.WriteLine("   other decision here is built on something that can shift.");
Console.WriteLine();
Console.WriteLine("   A CLOSED WINDOW means the set being walked is not changing, which is the");
Console.WriteLine("   only thing that makes a complete walk possible at all. A cursor removes");
Console.WriteLine("   duplicates; it cannot show you a row that arrived behind it.");
Console.WriteLine();
Console.WriteLine("   Everything else - the bounds, the allow-lists, the absent count - is");
Console.WriteLine("   about the same single idea from the other direction: THE SET OF QUERIES A");
Console.WriteLine("   CALLER CAN MAKE YOU RUN IS PART OF YOUR API, and it should be one you");
Console.WriteLine("   chose.");

// ---------------------------------------------------------------------------
static string Title(string problemJson)
{
    using JsonDocument document = JsonDocument.Parse(problemJson);

    return document.RootElement.TryGetProperty("title", out JsonElement title)
        ? title.GetString() ?? "(no title)"
        : "(no title)";
}

// ---------------------------------------------------------------------------
static class Allowed
{
    // The names a caller may use. They are part of the API, and they are
    // deliberately not the property names - renaming a property is then not a
    // breaking change.
    public static readonly string[] Statuses = ["captured", "pending", "failed"];

    public static readonly Dictionary<string, Func<Payment, IComparable>> Sorts =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["createdAt"] = p => p.CreatedAt,
            ["amountMinor"] = p => p.AmountMinor
        };
}

// A cursor is base64 of the last row's sort key and id. Opaque on purpose: the
// moment a caller can read it, its contents are part of the contract.
static class Cursor
{
    public static string KeyOf(Payment payment, string sortField) =>
        sortField.Equals("amountMinor", StringComparison.OrdinalIgnoreCase)
            ? payment.AmountMinor.ToString("D19")
            : payment.CreatedAt.ToString("O");

    public static string Encode(string key, string id) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes($"{key}|{id}"));

    public static bool TryDecode(string cursor, out string? key, out string? id)
    {
        key = null;
        id = null;

        try
        {
            string decoded = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            string[] parts = decoded.Split('|');

            if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0)
            {
                return false;
            }

            key = parts[0];
            id = parts[1];

            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

// ---------------------------------------------------------------------------
record Payment(string Id, string Status, long AmountMinor, DateTime CreatedAt);

record Item(string Id, string Status, long AmountMinor, DateTime CreatedAt);

record Page(List<Item> Items, bool HasMore, string? NextCursor);
