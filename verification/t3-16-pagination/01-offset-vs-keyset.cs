// 01-offset-vs-keyset.cs — What each scheme does when rows are being inserted
// and deleted underneath the caller, and what each costs at depth.
//
// Run:  dotnet run 01-offset-vs-keyset.cs -c Release
//
// EXACT vs RATIO: the row counts, duplicates and omissions are exact. The
// timings at the end are machine-specific; the SHAPE of the two curves is the
// claim, not the milliseconds.

#:sdk Microsoft.NET.Sdk
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;

WhatOffsetDoes();
WhatKeysetDoes();
Deletions();
Cost();
Comparison();

// ---------------------------------------------------------------------------
static void WhatOffsetDoes()
{
    Console.WriteLine("1. Offset paging while rows are arriving");
    Console.WriteLine();
    Console.WriteLine("   A caller walks 100 payments, newest first, ten at a time. Between each");
    Console.WriteLine("   page, two new payments arrive - which is what a payments table does.");
    Console.WriteLine();

    var table = Table.Of(100);
    var seen = new List<string>();

    for (int page = 1; page <= 10; page++)
    {
        // The query: ORDER BY CreatedAt DESC OFFSET (page-1)*10 LIMIT 10
        seen.AddRange(table.Rows
            .OrderByDescending(r => r.CreatedAt)
            .Skip((page - 1) * 10)
            .Take(10)
            .Select(r => r.Id));

        table.InsertNewest(2);
    }

    Report("offset", seen, table, originalCount: 100);
    Console.WriteLine();
    Console.WriteLine("   THE CALLER ASKED FOR TEN PAGES OF TEN AND GOT 100 ROWS, of which some");
    Console.WriteLine("   are the same row twice and 18 of the original 100 were never shown.");
    Console.WriteLine();
    Console.WriteLine("   Read the last two lines together. The rows that arrived mid-walk are");
    Console.WriteLine("   NOT the problem - a caller that started before they existed has no");
    Console.WriteLine("   claim on them. The problem is the rows that were there the whole time");
    Console.WriteLine("   and were stepped over.");
    Console.WriteLine();
    Console.WriteLine("   The mechanism is one sentence: OFFSET COUNTS FROM THE TOP OF A LIST");
    Console.WriteLine("   THAT IS STILL CHANGING. Two rows inserted at the front push everything");
    Console.WriteLine("   down by two, so the next page starts two rows earlier than the caller");
    Console.WriteLine("   intended and repeats what it already had.");
    Console.WriteLine();
    Console.WriteLine("   Deletions do the same thing in the other direction, which is the more");
    Console.WriteLine("   damaging case and is section 3.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatKeysetDoes()
{
    Console.WriteLine("2. The same walk, keyed on the last row seen");
    Console.WriteLine();
    Console.WriteLine("   Instead of 'give me rows 20 to 30', the caller says 'give me the ten");
    Console.WriteLine("   rows after this one':");
    Console.WriteLine();
    Console.WriteLine("     WHERE (CreatedAt, Id) < (@lastCreatedAt, @lastId)");
    Console.WriteLine("     ORDER BY CreatedAt DESC, Id DESC");
    Console.WriteLine("     LIMIT 10");
    Console.WriteLine();

    var table = Table.Of(100);
    var seen = new List<string>();

    (DateTime CreatedAt, string Id)? cursor = null;

    for (int page = 1; page <= 10; page++)
    {
        IEnumerable<Row> query = table.Rows;

        if (cursor is { } last)
        {
            // The comparison is on the PAIR, which is what makes it correct
            // when CreatedAt has duplicates - the subject of the next file.
            query = query.Where(r =>
                r.CreatedAt < last.CreatedAt
                || (r.CreatedAt == last.CreatedAt
                    && string.CompareOrdinal(r.Id, last.Id) < 0));
        }

        List<Row> rows = [.. query
            .OrderByDescending(r => r.CreatedAt)
            .ThenByDescending(r => r.Id, StringComparer.Ordinal)
            .Take(10)];

        seen.AddRange(rows.Select(r => r.Id));

        if (rows.Count > 0)
        {
            cursor = (rows[^1].CreatedAt, rows[^1].Id);
        }

        table.InsertNewest(2);
    }

    Report("keyset", seen, table, originalCount: 100);
    Console.WriteLine();
    Console.WriteLine("   NO DUPLICATES AND NONE OF THE ORIGINAL 100 MISSED, under exactly the");
    Console.WriteLine("   same inserts.");
    Console.WriteLine();
    Console.WriteLine("   The reason is that the caller is no longer describing a POSITION. It");
    Console.WriteLine("   is describing a ROW - 'everything older than this one' - and a row");
    Console.WriteLine("   does not move when other rows are inserted.");
    Console.WriteLine();
    Console.WriteLine("   NOTE WHAT THE NEW ROWS DID: nothing. They are newer than the cursor,");
    Console.WriteLine("   so they sort above everything the caller is walking towards and are");
    Console.WriteLine("   never reached. That is the correct answer for a feed - the caller");
    Console.WriteLine("   asked for what existed when it started, and it got exactly that.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Deletions()
{
    Console.WriteLine("3. The same walk, with rows being deleted");
    Console.WriteLine();
    Console.WriteLine("   Deletion is the case that turns 'a duplicate in a list' into 'a payment");
    Console.WriteLine("   nobody reconciled', because a shifted-up row is one NOBODY SEES.");
    Console.WriteLine();

    Console.WriteLine("   scheme   rows seen   distinct   duplicated   of the original 100:");
    Console.WriteLine("                                                deleted   missed anyway");
    Console.WriteLine("   ------   ---------   --------   ----------   -------   -------------");

    // Offset, with two rows deleted from the top between pages.
    {
        var table = Table.Of(100);
        var seen = new List<string>();

        for (int page = 1; page <= 10; page++)
        {
            seen.AddRange(table.Rows
                .OrderByDescending(r => r.CreatedAt)
                .Skip((page - 1) * 10)
                .Take(10)
                .Select(r => r.Id));

            table.DeleteNewest(2);
        }

        Line("offset", seen, table);
    }

    // Keyset, same deletions.
    {
        var table = Table.Of(100);
        var seen = new List<string>();

        (DateTime CreatedAt, string Id)? cursor = null;

        for (int page = 1; page <= 10; page++)
        {
            IEnumerable<Row> query = table.Rows;

            if (cursor is { } last)
            {
                query = query.Where(r =>
                    r.CreatedAt < last.CreatedAt
                    || (r.CreatedAt == last.CreatedAt
                        && string.CompareOrdinal(r.Id, last.Id) < 0));
            }

            List<Row> rows = [.. query
                .OrderByDescending(r => r.CreatedAt)
                .ThenByDescending(r => r.Id, StringComparer.Ordinal)
                .Take(10)];

            seen.AddRange(rows.Select(r => r.Id));

            if (rows.Count > 0)
            {
                cursor = (rows[^1].CreatedAt, rows[^1].Id);
            }

            table.DeleteNewest(2);
        }

        Line("keyset", seen, table);
    }

    Console.WriteLine();
    Console.WriteLine("   THE OFFSET WALK MISSED ROWS THAT WERE NEVER DELETED. Deleting from");
    Console.WriteLine("   above the caller's position pulls the whole list up, so the next");
    Console.WriteLine("   OFFSET lands past rows that have moved into the gap.");
    Console.WriteLine();
    Console.WriteLine("   A duplicate is visible - a user sees the same payment twice and");
    Console.WriteLine("   complains. A SKIPPED ROW IS INVISIBLE. Nothing anywhere records that a");
    Console.WriteLine("   row existed and was not returned, so a job that pages through a table");
    Console.WriteLine("   to reconcile it reports success having never seen some of the rows.");
    Console.WriteLine();
    Console.WriteLine("   READ THE LAST TWO COLUMNS. Both walks lost rows to deletion, which is");
    Console.WriteLine("   unavoidable and correct - a deleted row cannot be returned. Only the");
    Console.WriteLine("   offset walk lost rows that were never deleted, and those are the ones");
    Console.WriteLine("   nobody will ever account for.");
    Console.WriteLine();

    static void Line(string label, List<string> seen, Table table)
    {
        string[] duplicated = [.. seen.GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key)];

        // Every row deleted during the walk was one of the original 100 here,
        // because nothing is inserted in this section.
        int deleted = table.Deleted.Count;
        int missed = table.EverExisted.Except(seen).Except(table.Deleted).Count();

        Console.WriteLine($"   {label,-6}   {seen.Count,9}   {seen.Distinct().Count(),8}   " +
            $"{duplicated.Length,10}   {deleted,7}   {missed,13}");
    }
}

// ---------------------------------------------------------------------------
static void Cost()
{
    Console.WriteLine("4. What each costs at depth");
    Console.WriteLine();
    Console.WriteLine("   A million rows. Fetching ten of them from page 1, page 1,000 and page");
    Console.WriteLine("   50,000 - and then the same three positions by key.");
    Console.WriteLine();

    Row[] rows = [.. Enumerable.Range(1, 1_000_000)
        .Select(n => new Row($"PAY-{n:0000000}", new DateTime(2026, 1, 1).AddSeconds(n)))];

    Console.WriteLine("   position       offset: rows examined   by key: rows examined");
    Console.WriteLine("   --------       ---------------------   ---------------------");

    foreach (int page in new[] { 1, 1_000, 50_000 })
    {
        int offset = (page - 1) * 10;

        // OFFSET: the engine must produce and discard every row before the
        // window. Enumerable.Skip does exactly that, for the same reason.
        var counting = new CountingSource(rows);
        _ = counting.Skip(offset).Take(10).ToList();
        long offsetExamined = counting.Examined;

        // KEYSET: an index seek to one key, then ten rows. Modelled here as a
        // binary search, which is what an index lookup is.
        var keyed = new CountingSource(rows);
        long keyExamined = keyed.SeekAndTake(rows[offset].Id, 10);

        Console.WriteLine($"   page {page,-9}  {offsetExamined,21:n0}   {keyExamined,21:n0}");
    }

    Console.WriteLine();
    Console.WriteLine("   and the same three, timed - three ways:");
    Console.WriteLine();
    Console.WriteLine("   position       Skip on an array   Skip on a sequence   by key");
    Console.WriteLine("   --------       ----------------   ------------------   ------");

    foreach (int page in new[] { 1, 1_000, 50_000 })
    {
        int offset = (page - 1) * 10;

        // LINQ over an array can index straight to the offset, so this is
        // constant - and it is NOT what a database does.
        double indexedMs = Time(() => rows.Skip(offset).Take(10).ToList());

        // The same Skip over something that has to be enumerated. Where(_ =>
        // true) removes LINQ's ability to index, which is the situation a
        // database is always in: rows have to be produced in sort order
        // before anything can count them.
        double walkedMs = Time(() => rows.Where(_ => true).Skip(offset).Take(10).ToList());

        double keyMs = Time(() =>
        {
            string after = rows[offset].Id;
            var window = new List<Row>(10);

            int start = Array.BinarySearch(rows, new Row(after, default),
                Comparer<Row>.Create((a, b) => string.CompareOrdinal(a.Id, b.Id)));

            for (int i = Math.Max(0, start); i < rows.Length && window.Count < 10; i++)
            {
                window.Add(rows[i]);
            }

            return window;
        });

        Console.WriteLine($"   page {page,-9}  {indexedMs,13:0.000} ms   {walkedMs,15:0.000} ms   " +
            $"{keyMs,4:0.000} ms");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIRST COLUMN IS FLAT AND IT IS THE MISLEADING ONE. LINQ over an");
    Console.WriteLine("   array knows the length and the element size, so Skip(500000) is a");
    Console.WriteLine("   pointer arithmetic operation.");
    Console.WriteLine();
    Console.WriteLine("   A DATABASE CANNOT DO THAT, and the reason is worth understanding");
    Console.WriteLine("   rather than memorising: rows have to be produced IN SORT ORDER before");
    Console.WriteLine("   anything can count to 500,000, and producing them is the expensive");
    Console.WriteLine("   part. There is no address to jump to, because the ordering is a");
    Console.WriteLine("   property of the query rather than of the storage.");
    Console.WriteLine();
    Console.WriteLine("   The middle column removes LINQ's shortcut and shows the shape a");
    Console.WriteLine("   database has. It is the one to reason from.");
    Console.WriteLine();
    Console.WriteLine("   OFFSET COST GROWS WITH THE OFFSET AND KEYSET COST DOES NOT. That is");
    Console.WriteLine("   the whole performance argument, and it is not about LINQ - a database");
    Console.WriteLine("   does the same thing for the same reason.");
    Console.WriteLine();
    Console.WriteLine("   OFFSET 500000 does not mean 'jump to row 500,000'. There is no jumping:");
    Console.WriteLine("   the engine produces rows in order and throws the first 500,000 away.");
    Console.WriteLine("   The work is done and then discarded.");
    Console.WriteLine();
    Console.WriteLine("   A keyset query is an index seek to one value followed by a read of ten");
    Console.WriteLine("   adjacent entries, and it costs the same whether the value is near the");
    Console.WriteLine("   start of the index or the end.");
    Console.WriteLine();
    Console.WriteLine("   THE PRACTICAL CONSEQUENCE: deep offset paging is a way for a caller to");
    Console.WriteLine("   ask you to do arbitrarily much work with a request that looks small.");
    Console.WriteLine("   ?page=50000 is 34 characters and half a million rows of work.");
    Console.WriteLine();

    static double Time(Func<object> action)
    {
        // Warm up, then take the best of five - the fastest run is the one
        // least disturbed by everything else on the machine.
        action();

        double best = double.MaxValue;

        for (int run = 0; run < 5; run++)
        {
            var stopwatch = Stopwatch.StartNew();
            action();
            stopwatch.Stop();

            best = Math.Min(best, stopwatch.Elapsed.TotalMilliseconds);
        }

        return best;
    }
}

// ---------------------------------------------------------------------------
static void Comparison()
{
    Console.WriteLine("5. Which to use");
    Console.WriteLine();
    Console.WriteLine("   property                          offset          keyset");
    Console.WriteLine("   --------                          ------          ------");
    Console.WriteLine("   stable while rows change          no              yes");
    Console.WriteLine("   cost at page 50,000               grows           constant");
    Console.WriteLine("   jump to an arbitrary page         yes             no");
    Console.WriteLine("   show a total page count           yes, at a cost  no");
    Console.WriteLine("   go backwards                      yes             yes, with work");
    Console.WriteLine("   simple to implement               yes             mostly");
    Console.WriteLine();
    Console.WriteLine("   KEYSET FOR ANYTHING A MACHINE WALKS: an export, a sync, a");
    Console.WriteLine("   reconciliation job, an infinite-scroll feed. These need every row");
    Console.WriteLine("   exactly once and never need page 400.");
    Console.WriteLine();
    Console.WriteLine("   OFFSET FOR A HUMAN LOOKING AT A TABLE with numbered pages, where being");
    Console.WriteLine("   able to click '7' matters and a row appearing twice on a screen");
    Console.WriteLine("   somebody is reading is a cosmetic problem rather than a data one.");
    Console.WriteLine();
    Console.WriteLine("   AND EVEN THEN, CAP THE DEPTH. A user interface that offers page 50,000");
    Console.WriteLine("   is offering something nobody wants and a crawler will take. Most");
    Console.WriteLine("   systems that need deep pages actually need search or a filter.");
    Console.WriteLine();
    Console.WriteLine("   THE HONEST SUMMARY: offset is not wrong, it is a different guarantee.");
    Console.WriteLine("   It gives you positions in a snapshot that does not exist, and that is");
    Console.WriteLine("   fine for a screen and wrong for a job.");
}

// ---------------------------------------------------------------------------
static void Report(string label, List<string> seen, Table table, int originalCount)
{
    string[] duplicated = [.. seen.GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key)];

    // The rows that existed when the walk began. Missing one of these is the
    // defect; never reaching a row inserted afterwards is not.
    string[] original = [.. table.EverExisted.Take(originalCount)];
    string[] missed = [.. original.Except(seen).Except(table.Deleted)];
    int arrivedLater = table.EverExisted.Count - originalCount;

    Console.WriteLine($"   scheme                          {label}");
    Console.WriteLine($"   rows the caller saw             {seen.Count}");
    Console.WriteLine($"   distinct rows                   {seen.Distinct().Count()}");
    Console.WriteLine($"   rows seen twice                 {duplicated.Length}" +
        (duplicated.Length > 0 ? $"  ({string.Join(", ", duplicated.Take(4))}...)" : ""));
    Console.WriteLine($"   of the original {originalCount}, missed      {missed.Length}" +
        (missed.Length > 0 ? $"  ({string.Join(", ", missed.Take(4))}...)" : ""));
    Console.WriteLine($"   rows that arrived mid-walk      {arrivedLater}  (not expected to appear)");
}

// ---------------------------------------------------------------------------
record Row(string Id, DateTime CreatedAt);

// Stands in for a table that other people are writing to while you read it.
sealed class Table
{
    private readonly List<Row> _rows = [];
    private int _next;

    public List<Row> Rows => _rows;

    public List<string> EverExisted { get; } = [];

    public List<string> Deleted { get; } = [];

    public static Table Of(int count)
    {
        var table = new Table();
        table.InsertNewest(count);

        return table;
    }

    public void InsertNewest(int count)
    {
        for (int i = 0; i < count; i++)
        {
            var row = new Row($"PAY-{++_next:000}", new DateTime(2026, 1, 1).AddMinutes(_next));

            _rows.Add(row);
            EverExisted.Add(row.Id);
        }
    }

    public void DeleteNewest(int count)
    {
        foreach (Row row in _rows.OrderByDescending(r => r.CreatedAt).Take(count).ToList())
        {
            _rows.Remove(row);
            Deleted.Add(row.Id);
        }
    }
}

// Counts how many rows had to be produced to answer a query, which is the
// quantity a database's OFFSET is spending.
sealed class CountingSource(Row[] rows)
{
    public long Examined { get; private set; }

    public IEnumerable<Row> Skip(int count)
    {
        foreach (Row row in rows)
        {
            Examined++;

            if (count > 0)
            {
                count--;
                continue;
            }

            yield return row;
        }
    }

    // An index seek: find one key, then read forward. The seek itself is
    // logarithmic, which is why the count barely moves with depth.
    public long SeekAndTake(string afterId, int take)
    {
        long examined = (long)Math.Ceiling(Math.Log2(rows.Length));

        int start = Array.BinarySearch(rows, new Row(afterId, default),
            Comparer<Row>.Create((a, b) => string.CompareOrdinal(a.Id, b.Id)));

        for (int i = Math.Max(0, start); i < rows.Length && examined < take + 20; i++)
        {
            examined++;
        }

        return examined;
    }
}
