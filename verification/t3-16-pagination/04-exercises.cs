// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every count and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

One();
Two();
await Three();
Four();

// ---------------------------------------------------------------------------
static void One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the duplicate in the export");
    Console.WriteLine();
    Console.WriteLine("   A customer exports their payments to a spreadsheet. The export pages");
    Console.WriteLine("   through the API 100 at a time, newest first, and the spreadsheet has");
    Console.WriteLine("   one payment listed twice.");
    Console.WriteLine();
    Console.WriteLine("   The export code is correct and the API is correct. What happened?");
    Console.WriteLine();

    var table = new List<Row>();

    for (int n = 1; n <= 300; n++)
    {
        table.Add(new Row($"PAY-{n:000}", new DateTime(2026, 1, 1).AddMinutes(n)));
    }

    var seen = new List<string>();

    Console.WriteLine("   page   first row   last row    new arrivals before the next page");
    Console.WriteLine("   ----   ---------   --------    ---------------------------------");

    for (int page = 1; page <= 3; page++)
    {
        List<Row> rows = [.. table
            .OrderByDescending(r => r.CreatedAt)
            .Skip((page - 1) * 100)
            .Take(100)];

        seen.AddRange(rows.Select(r => r.Id));

        int arrivals = page < 3 ? 3 : 0;

        Console.WriteLine($"   {page,4}   {rows[0].Id,-9}   {rows[^1].Id,-8}    {arrivals}");

        for (int i = 0; i < arrivals; i++)
        {
            table.Add(new Row($"NEW-{table.Count:000}",
                new DateTime(2026, 1, 1).AddMinutes(1_000 + table.Count)));
        }
    }

    string[] duplicated = [.. seen.GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key)];

    Console.WriteLine();
    Console.WriteLine($"   rows in the spreadsheet   {seen.Count}");
    Console.WriteLine($"   distinct                  {seen.Distinct().Count()}");
    Console.WriteLine($"   listed twice              {string.Join(", ", duplicated)}");
    Console.WriteLine();
    Console.WriteLine("   ANSWER: three payments arrived between page 1 and page 2, and three");
    Console.WriteLine("   more between page 2 and page 3. Each arrival pushed the whole list");
    Console.WriteLine("   down by one, so each page started earlier than the caller intended and");
    Console.WriteLine("   repeated rows it had already returned.");
    Console.WriteLine();
    Console.WriteLine("   NEITHER SIDE IS WRONG. The export asked for rows 100-200 and got rows");
    Console.WriteLine("   100-200 - of a list that had six more rows at the top than it did when");
    Console.WriteLine("   page 1 was fetched.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS TO STOP DESCRIBING A POSITION. A cursor naming the last row");
    Console.WriteLine("   seen is immune to inserts above it, because a row does not move when");
    Console.WriteLine("   other rows are added.");
    Console.WriteLine();
    Console.WriteLine("   AND THE WIDER LESSON: OFFSET PAGING IS A SNAPSHOT API OVER SOMETHING");
    Console.WriteLine("   THAT IS NOT A SNAPSHOT. It is fine for a screen a person is reading");
    Console.WriteLine("   and wrong for anything that has to be complete.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the query that got slower every month");
    Console.WriteLine();
    Console.WriteLine("   An admin screen lists payments with numbered pages. It was instant at");
    Console.WriteLine("   launch. Two years later, page 1 is instant, page 50 is fine, and page");
    Console.WriteLine("   4,000 times out.");
    Console.WriteLine();
    Console.WriteLine("   Explain the shape, and give two fixes with their costs.");
    Console.WriteLine();

    Row[] rows = [.. Enumerable.Range(1, 400_000)
        .Select(n => new Row($"PAY-{n:0000000}", new DateTime(2026, 1, 1).AddSeconds(n)))];

    Console.WriteLine("   page      offset     rows the engine must produce and discard");
    Console.WriteLine("   ----      ------     ----------------------------------------");

    foreach (int page in new[] { 1, 50, 500, 4_000 })
    {
        int offset = (page - 1) * 100;

        // Enumerated rather than indexed, because a database has to produce
        // rows in sort order before it can count past them.
        long produced = 0;

        foreach (Row _ in rows.Where(_ => true).Skip(offset).Take(100))
        {
            produced++;
        }

        Console.WriteLine($"   {page,4}   {offset,9:n0}     {offset + produced,12:n0}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: the cost of an OFFSET query is proportional to the offset, not");
    Console.WriteLine("   to the page size. Page 4,000 asks the engine to produce 399,900 rows in");
    Console.WriteLine("   sorted order and throw them away before returning 100.");
    Console.WriteLine();
    Console.WriteLine("   It got slower every month because the offsets got bigger every month.");
    Console.WriteLine("   Nothing about the query changed.");
    Console.WriteLine();
    Console.WriteLine("   FIX ONE: KEYSET PAGING. Constant cost at any depth. The cost is that");
    Console.WriteLine("   numbered pages go away - a cursor can go next and previous, and cannot");
    Console.WriteLine("   jump to page 4,000, because 'page 4,000' is not a thing that exists");
    Console.WriteLine("   without counting.");
    Console.WriteLine();
    Console.WriteLine("   FIX TWO: CAP THE DEPTH. Keep offset paging, reject anything past page");
    Console.WriteLine("   100, and tell the caller to filter instead. The cost is that a screen");
    Console.WriteLine("   which genuinely needed page 4,000 now cannot show it.");
    Console.WriteLine();
    Console.WriteLine("   WHICH TO CHOOSE DEPENDS ON A QUESTION ABOUT PEOPLE, not about code:");
    Console.WriteLine("   DOES ANYBODY ACTUALLY GO TO PAGE 4,000?");
    Console.WriteLine();
    Console.WriteLine("   Almost always the answer is no - the traffic is a crawler, or somebody");
    Console.WriteLine("   who wanted a search and used the only tool on the screen. In that case");
    Console.WriteLine("   fix two is a smaller change and the honest answer is that the screen");
    Console.WriteLine("   needs a filter rather than deeper pages.");
    Console.WriteLine();
    Console.WriteLine("   If somebody genuinely does page deeply - a support agent working a");
    Console.WriteLine("   queue, an operator scanning for something - they do not want page 4,000");
    Console.WriteLine("   either. They want the rows that page 4,000 happens to contain, which is");
    Console.WriteLine("   a filter with a different name.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium) - the page size nobody bounded");
    Console.WriteLine();
    Console.WriteLine("   An endpoint takes ?pageSize= and passes it to Take(). Design the");
    Console.WriteLine("   handling, and say what each rejected case should return.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddProblemDetails();

    var app = builder.Build();

    Row[] rows = [.. Enumerable.Range(1, 5_000)
        .Select(n => new Row($"PAY-{n:0000}", new DateTime(2026, 1, 1).AddMinutes(n)))];

    // Unbounded: whatever the caller says.
    app.MapGet("/v1/payments", (int pageSize = 20) =>
        Results.Ok(new { count = rows.Take(pageSize).Count() }));

    // Bounded, with the three decisions made explicitly.
    app.MapGet("/v2/payments", (int? pageSize) =>
    {
        const int Default = 20;
        const int Max = 100;

        int requested = pageSize ?? Default;

        if (requested < 1)
        {
            return Results.Problem(
                title: "pageSize must be at least 1",
                statusCode: 400);
        }

        if (requested > Max)
        {
            return Results.Problem(
                title: $"pageSize must be at most {Max}",
                detail: $"You asked for {requested}. Use a cursor to read more than {Max} rows.",
                statusCode: 400);
        }

        return Results.Ok(new { count = rows.Take(requested).Count() });
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   ?pageSize=       unbounded            bounded");
    Console.WriteLine("   ----------       ---------            -------");

    foreach (string query in new[] { "", "?pageSize=20", "?pageSize=500", "?pageSize=1000000", "?pageSize=0", "?pageSize=-1" })
    {
        string one = await Describe(http, $"/v1/payments{query}");
        string two = await Describe(http, $"/v2/payments{query}");

        Console.WriteLine($"   {(query.Length == 0 ? "(omitted)" : query[1..]),-15}  {one,-19}  {two}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: three decisions, and all three have to be made.");
    Console.WriteLine();
    Console.WriteLine("     A DEFAULT, for the caller who says nothing. Small enough that an");
    Console.WriteLine("     accidental unbounded read is cheap - 20 or 25, not 1,000.");
    Console.WriteLine();
    Console.WriteLine("     A MAXIMUM, for the caller who asks for too much. This is the one");
    Console.WriteLine("     that stops a single request from reading the table.");
    Console.WriteLine();
    Console.WriteLine("     A MINIMUM, because 0 and -1 are values a caller can send. Note what");
    Console.WriteLine("     the unbounded column does with them: 200 and zero rows, silently.");
    Console.WriteLine("     Take(-1) does not throw - it returns nothing - so a client looping");
    Console.WriteLine("     until a short page arrives terminates immediately having read no");
    Console.WriteLine("     data and seen no error.");
    Console.WriteLine();
    Console.WriteLine("   REJECT RATHER THAN CLAMP, and this is the part worth arguing about.");
    Console.WriteLine("   Silently returning 100 rows to a caller who asked for 5,000 means they");
    Console.WriteLine("   believe they have everything, and a client that loops 'until fewer than");
    Console.WriteLine("   pageSize rows come back' terminates immediately with 2% of the data.");
    Console.WriteLine();
    Console.WriteLine("   A 400 naming the maximum is one line to read and one line to fix.");
    Console.WriteLine();
    Console.WriteLine("   AND NOTE THE UNBOUNDED COLUMN FOR ?pageSize=1000000: it returned every");
    Console.WriteLine("   row in the table from a request that is 22 characters long.");
    Console.WriteLine();

    static async Task<string> Describe(HttpClient http, string path)
    {
        using HttpResponseMessage response = await http.GetAsync(path);

        if (!response.IsSuccessStatusCode)
        {
            return $"{(int)response.StatusCode}";
        }

        CountResult? result = await response.Content.ReadFromJsonAsync<CountResult>();

        return $"200, {result?.Count} rows";
    }
}

// ---------------------------------------------------------------------------
static void Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - design the contract");
    Console.WriteLine();
    Console.WriteLine("   Design paging, filtering and sorting for GET /v1/payments, given:");
    Console.WriteLine();
    Console.WriteLine("     - a customer-facing list screen with next/previous;");
    Console.WriteLine("     - a nightly export that must see every payment exactly once;");
    Console.WriteLine("     - a support tool that filters by status and date;");
    Console.WriteLine("     - a table with 40 million rows.");
    Console.WriteLine();

    Console.WriteLine("   THE ANSWER, and the reasoning for each part:");
    Console.WriteLine();
    Console.WriteLine("   1. ONE SCHEME: KEYSET, FOR EVERYBODY.");
    Console.WriteLine();
    Console.WriteLine("      The export needs it for correctness and the screen needs it for");
    Console.WriteLine("      speed at 40 million rows. Two schemes would be two code paths, two");
    Console.WriteLine("      sets of tests, and a question about which one a given caller is on.");
    Console.WriteLine();
    Console.WriteLine("      The screen loses numbered pages. That is a real cost and it is");
    Console.WriteLine("      almost always acceptable, because a customer list screen with 40");
    Console.WriteLine("      million rows behind it has no meaningful page 200,000 anyway.");
    Console.WriteLine();
    Console.WriteLine("   2. THE CURSOR IS OPAQUE.");
    Console.WriteLine();
    Console.WriteLine("        { \"cursor\": \"eyJjIjoiMjAyNi0wMS0wMVQwOTowMFoiLCJpIjoiUEFZLTEifQ\" }");
    Console.WriteLine();
    Console.WriteLine("      Base64 of the last row's sort key. Opaque for a specific reason: the");
    Console.WriteLine("      moment a caller can read it, the columns in it are part of your");
    Console.WriteLine("      contract, and you can never change the sort key without a version.");
    Console.WriteLine();
    Console.WriteLine("      It also has to be VALIDATED and not merely decoded - a cursor is");
    Console.WriteLine("      caller-supplied input, and decoding one into a WHERE clause without");
    Console.WriteLine("      checking it is the same mistake as a caller-supplied sort column.");
    Console.WriteLine();
    Console.WriteLine("   3. ORDER BY (CreatedAt DESC, Id DESC), ALWAYS, with an index to match.");
    Console.WriteLine();
    Console.WriteLine("      Unique, so no plan can reorder it. Indexed, so no page has to sort.");
    Console.WriteLine();
    Console.WriteLine("   4. PAGE SIZE: default 25, maximum 100, reject outside that.");
    Console.WriteLine();
    Console.WriteLine("   5. FILTERS FROM AN ALLOW-LIST, with operators named per field:");
    Console.WriteLine();
    Console.WriteLine("        status      eq, in            indexed");
    Console.WriteLine("        createdAt   gte, lt           indexed, and the sort column");
    Console.WriteLine("        amountMinor gte, lte          indexed");
    Console.WriteLine("        reference   eq ONLY           NOT contains - a leading wildcard");
    Console.WriteLine("                                      cannot use an index");
    Console.WriteLine();
    Console.WriteLine("      An unrecognised field is a 400 naming it. Ignoring it would return");
    Console.WriteLine("      unfiltered data to somebody who believes it was filtered.");
    Console.WriteLine();
    Console.WriteLine("   6. NO TOTAL COUNT BY DEFAULT.");
    Console.WriteLine();
    Console.WriteLine("      COUNT(*) over 40 million filtered rows is a second query as");
    Console.WriteLine("      expensive as the page - often more, because it cannot stop early.");
    Console.WriteLine("      Return hasMore instead, computed by fetching pageSize + 1 rows and");
    Console.WriteLine("      returning pageSize of them.");
    Console.WriteLine();
    Console.WriteLine("      Offer an exact count behind an explicit ?includeTotal=true if");
    Console.WriteLine("      somebody genuinely needs it, so the cost is something a caller asks");
    Console.WriteLine("      for rather than something every caller pays.");
    Console.WriteLine();
    Console.WriteLine("   7. THE EXPORT READS A CLOSED WINDOW.");
    Console.WriteLine();
    Console.WriteLine("      createdAt >= yesterday AND createdAt < today, run after midnight, so");
    Console.WriteLine("      no row can arrive inside the window while the walk is running. This");
    Console.WriteLine("      is the correctness fix; keyset is the performance one.");
    Console.WriteLine();
    Console.WriteLine("   THE SHAPE OF THE RESPONSE:");
    Console.WriteLine();
    Console.WriteLine("     {");
    Console.WriteLine("       \"items\": [ ... 25 payments ... ],");
    Console.WriteLine("       \"hasMore\": true,");
    Console.WriteLine("       \"nextCursor\": \"eyJjIjoi...\"");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   NOTE WHAT IS ABSENT: no page number, no total, no page count. Each of");
    Console.WriteLine("   those is a promise about a snapshot that does not exist, and every one");
    Console.WriteLine("   of them costs a query to keep.");
    Console.WriteLine();
    Console.WriteLine("   THE ONE THING THAT MAKES ALL OF IT WORK is that the caller never");
    Console.WriteLine("   describes a position. Everything above is a consequence of that single");
    Console.WriteLine("   decision.");
}

// ---------------------------------------------------------------------------
record Row(string Id, DateTime CreatedAt);

record CountResult(int Count);
