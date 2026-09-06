CSPREP.module({
  id: "t3-16-pagination",
  minutes: 55,
  updated: "2026-09-04",
  summary: "A nightly reconciliation reported success every night for four months while missing payments, from two independent defects in one query - an ORDER BY that was not a total order, and an OFFSET counting positions in a result set still being written to. Offset against keyset measured under inserts and deletions, the cost curve at depth, why a caller-supplied sort field can read a column no response contains, and the finding that matters most: keyset paging removes duplicates and does not make a walk complete. Only a closed window does that.",
  terms: ["pagination", "offset paging", "keyset paging", "cursor", "seek paging", "total order",
    "tiebreaker", "stable ordering", "closed window", "page size", "allow-list", "filter contract",
    "hasMore", "COUNT(*)", "deep paging"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Every night at 01:00, Ledger reconciles the day's payments against the gateway's settlement file.
  It pages through the payments table:</p>

  <pre data-lang="sql" data-bad="true" data-title="Wrong - and it ran every night for two years"><code>SELECT * FROM Payments
WHERE CreatedAt &gt;= @from AND CreatedAt &lt; @to
ORDER BY CreatedAt
OFFSET @offset ROWS FETCH NEXT 500 ROWS ONLY</code></pre>

  <p>It logs how many payments it reconciled and it has never once reported an error. What it actually
  reconciled, on one night's traffic:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   query                                  reconciled   missed   double-counted
   -----                                  ----------   ------   --------------
   ORDER BY CreatedAt, OFFSET                   5009       13               11
   ORDER BY CreatedAt, Id, OFFSET               5009       13               11
   ORDER BY CreatedAt, Id, keyset               5009       13                0
   keyset over a CLOSED window                  5000        0                0</code></pre>

  <p>Two defects, and fixing either one alone leaves a job that quietly under-reports.
  <code>ORDER BY CreatedAt</code> is not a total order, because payments are written in batches and
  hundreds share a timestamp. <code>OFFSET</code> counts positions in a result set that is still being
  written to, because 01:00 is quiet and not empty.</p>

  <p>And the reporting made it invisible. The job logs what it reconciled — a number it computes from
  what it saw. <strong>A job that pages past a row does not know the row existed</strong>, so the count
  it reports is itself derived from the bug. Every dashboard and every log line was consistent with
  itself and wrong.</p>

  <p>What found it, after four months, was the gateway's monthly statement not matching the ledger's.
  Not a log, not an alert, not a test — an external party with an independent count.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>Every count in this module was produced by running the programs shown, on .NET 10, and pasted in
    unedited. The tables are lists in memory rather than a database, because none is available offline;
    where that changes what a measurement means — and in one case it does — the file says so.</p>
  </div>
</section>

<section id="plain-language">
  <h2>What paging is, and what it promises</h2>

  <p class="define"><span class="define__term">Paging</span> Returning a large result a piece at a time,
  so no single request has to produce, transmit or hold all of it.</p>

  <p class="define"><span class="define__term">Offset paging</span> The caller says which
  <em>position</em> to start at: "rows 100 to 200". Rendered as <code>?page=11</code> or
  <code>OFFSET 100</code>.</p>

  <p class="define"><span class="define__term">Keyset paging</span> The caller says which <em>row</em>
  to start after: "everything older than this payment". Also called cursor or seek paging.</p>

  <p class="define"><span class="define__term">Cursor</span> An opaque string identifying the last row a
  caller received, which it sends back to get the next page.</p>

  <p class="define"><span class="define__term">Page size</span> How many rows one request returns. It is
  the single number that decides how much work a caller can ask you to do, which is why it is the one
  parameter that must always be bounded.</p>

  <p class="define"><span class="define__term">Snapshot</span> A view of data frozen at one moment.
  Offset paging behaves correctly over a snapshot and incorrectly over anything else — and a table other
  people are writing to is not one.</p>

  <pre data-lang="csharp" data-net="10" data-title="00-smallest.cs"><code>var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// Stands in for a table. Fifty payments, newest first.
var payments = Enumerable.Range(1, 50)
    .Select(n =&gt; new Payment($"PAY-{n:000}", 1_000L * n, new DateTime(2026, 1, 1).AddMinutes(n)))
    .OrderByDescending(p =&gt; p.CreatedAt)
    .ToList();

var app = builder.Build();

// The version everybody writes first.
app.MapGet("/v1/payments", (int page = 1, int pageSize = 10) =&gt; Results.Ok(new
{
    page,
    pageSize,
    total = payments.Count,
    items = payments.Skip((page - 1) * pageSize).Take(pageSize).Select(p =&gt; p.Id)
}));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   ?page=1   {"page":1,"pageSize":10,"total":50,"items":["PAY-050",...,"PAY-041"]}
   ?page=2   {"page":2,"pageSize":10,"total":50,"items":["PAY-040",...,"PAY-031"]}

   ?pageSize=1000000   200, 50 items returned

   page 1, before the insert   PAY-050 PAY-049 ... PAY-042 PAY-041
   page 2, after the insert    PAY-041 PAY-040 ... PAY-033 PAY-032

   rows the caller has seen    20
   distinct rows               19
   duplicated                  PAY-041</code></pre>

  <p>That is what almost every API does, and two things about it are already wrong.</p>

  <p><strong>The caller decides how much work you do.</strong> Nothing rejected a page size of a
  million, so one request can ask for the whole table — and a client can send fifty of them at once.</p>

  <p><strong>A page number is a position in a list that is still changing.</strong> One row inserted at
  the front shifted everything down by one, so the row that was last on page 1 is first on page 2.
  Nothing failed; the requests were correct, the responses were correct, and the client's list has a
  duplicate in it.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Offset paging is like reading a book by page number. "Continue from page 47" works because the book
  is not being retypeset while you read it.</p>

  <p><strong>This is an analogy and it misleads about exactly one property: the book is finished.</strong>
  A database table is a book that somebody is inserting pages into while you read, at the front, where
  it shifts every page number after it. Keyset paging is the equivalent of putting a bookmark in — the
  bookmark stays with the same words however many pages are added elsewhere.</p>
</section>

<section id="offset-vs-keyset">
  <h2>What each scheme does when the data moves</h2>

  <p class="define"><span class="define__term">Index</span> A separate structure the database keeps,
  holding the values of one or more columns in sorted order alongside pointers to the rows. It exists so
  that finding a value does not require reading every row.</p>

  <p class="define"><span class="define__term">Index seek</span> Finding one value in an index directly,
  rather than scanning. The cost grows with the logarithm of the table size, which in practice means it
  barely grows at all — this is what makes keyset paging constant-cost.</p>

  <p class="define"><span class="define__term">Table scan</span> Reading every row because no index can
  answer the question. It is the cost of a filter the schema was not designed for, and it is the thing a
  filter contract exists to prevent a caller from requesting.</p>

  <p>A caller walks 100 payments, ten at a time. Between each page, two new payments arrive:</p>

  <pre data-lang="console" data-title="01-offset-vs-keyset.cs output"><code>   scheme                          offset
   rows the caller saw             100
   distinct rows                   82
   rows seen twice                 18  (PAY-092, PAY-091, PAY-084, PAY-083...)
   of the original 100, missed     18  (PAY-001, PAY-002, PAY-003, PAY-004...)
   rows that arrived mid-walk      20  (not expected to appear)</code></pre>

  <p>The rows that arrived mid-walk are not the problem — a caller that started before they existed has
  no claim on them. The problem is the eighteen rows that were there the whole time and were stepped
  over.</p>

  <p>The same walk, keyed on the last row seen:</p>

  <pre data-lang="csharp" data-net="10" data-title="01-offset-vs-keyset.cs"><code>IEnumerable&lt;Row&gt; query = table.Rows;

if (cursor is { } last)
{
    // The comparison is on the PAIR, which is what makes it correct
    // when CreatedAt has duplicates.
    query = query.Where(r =&gt;
        r.CreatedAt &lt; last.CreatedAt
        || (r.CreatedAt == last.CreatedAt
            &amp;&amp; string.CompareOrdinal(r.Id, last.Id) &lt; 0));
}

List&lt;Row&gt; rows = [.. query
    .OrderByDescending(r =&gt; r.CreatedAt)
    .ThenByDescending(r =&gt; r.Id, StringComparer.Ordinal)
    .Take(10)];</code></pre>

  <pre data-lang="console" data-title="01-offset-vs-keyset.cs output"><code>   scheme                          keyset
   rows the caller saw             100
   distinct rows                   100
   rows seen twice                 0
   of the original 100, missed     0
   rows that arrived mid-walk      20  (not expected to appear)</code></pre>

  <p>No duplicates and none of the original hundred missed, under exactly the same inserts. The caller
  is no longer describing a position — it is describing a row, and <strong>a row does not move when
  other rows are inserted</strong>.</p>

  <h3>Deletion, which is the worse case</h3>

  <pre data-lang="console" data-title="01-offset-vs-keyset.cs output"><code>   scheme   rows seen   distinct   duplicated   of the original 100:
                                                deleted   missed anyway
   ------   ---------   --------   ----------   -------   -------------
   offset          84         84            0        20              14
   keyset         100        100            0        20               0</code></pre>

  <p>Both walks lost rows to deletion, which is unavoidable and correct. Only the offset walk lost rows
  that were never deleted.</p>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>A duplicate is visible — a user sees the same payment twice and complains. <strong>A skipped row
    is invisible.</strong> Nothing anywhere records that a row existed and was not returned, so a job
    that pages through a table to reconcile it reports success having never seen some of the rows.</p>
  </div>
</section>

<section id="cost">
  <h2>What each costs at depth</h2>

  <p>A million rows, fetching ten of them from three positions:</p>

  <pre data-lang="console" data-title="01-offset-vs-keyset.cs output"><code>   position       offset: rows examined   by key: rows examined
   --------       ---------------------   ---------------------
   page 1                             10                      30
   page 1000                      10,000                      30
   page 50000                    500,000                      30

   position       Skip on an array   Skip on a sequence   by key
   --------       ----------------   ------------------   ------
   page 1                  0.000 ms             0.001 ms   0.001 ms
   page 1000               0.001 ms             0.117 ms   0.001 ms
   page 50000              0.001 ms             3.420 ms   0.001 ms</code></pre>

  <p><strong>The first timing column is flat and it is the misleading one.</strong> LINQ over an array
  knows the length and the element size, so <code>Skip(500000)</code> is pointer arithmetic.</p>

  <p>A database cannot do that, and the reason is worth understanding rather than memorising: rows have
  to be produced <em>in sort order</em> before anything can count to 500,000, and producing them is the
  expensive part. There is no address to jump to, because the ordering is a property of the query rather
  than of the storage. The middle column removes LINQ's shortcut and shows the shape a database has.</p>

  <p><code>OFFSET 500000</code> does not mean "jump to row 500,000". The engine produces rows in order
  and throws the first 500,000 away — the work is done and then discarded. A keyset query is an index
  seek to one value followed by a read of ten adjacent entries, and it costs the same wherever that
  value is.</p>

  <p><strong>The practical consequence: deep offset paging is a way for a caller to ask you to do
  arbitrarily much work with a request that looks small.</strong> <code>?page=50000</code> is 34
  characters and half a million rows of work.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Property</th><th>Offset</th><th>Keyset</th></tr></thead>
      <tbody>
        <tr><td>Stable while rows change</td><td>no</td><td>yes</td></tr>
        <tr><td>Cost at page 50,000</td><td>grows</td><td>constant</td></tr>
        <tr><td>Jump to an arbitrary page</td><td>yes</td><td>no</td></tr>
        <tr><td>Show a total page count</td><td>yes, at a cost</td><td>no</td></tr>
        <tr><td>Go backwards</td><td>yes</td><td>yes, with work</td></tr>
      </tbody>
    </table>
  </div>

  <p><strong>Keyset for anything a machine walks</strong> — an export, a sync, a reconciliation job, an
  infinite-scroll feed. These need every row exactly once and never need page 400. <strong>Offset for a
  human looking at a table</strong> with numbered pages, where clicking "7" matters and a row appearing
  twice on a screen is cosmetic rather than a data problem.</p>

  <p>And even then, cap the depth. A user interface that offers page 50,000 is offering something nobody
  wants and a crawler will take. Offset is not wrong — it is a different guarantee. It gives you
  positions in a snapshot that does not exist, which is fine for a screen and wrong for a job.</p>
</section>

<section id="stable-ordering">
  <h2>Ordering by something that is not unique</h2>

  <p class="define"><span class="define__term">Total order</span> An ordering in which no two rows
  compare equal, so exactly one arrangement satisfies it. A <strong>partial order</strong> leaves ties
  unresolved, and every arrangement of the tied rows is equally correct.</p>

  <p class="define"><span class="define__term">Execution plan</span> The strategy the database chose for
  one query — which index to use, whether to sort, whether to work in parallel. It is chosen fresh from
  statistics about the data, so the same query text can be executed differently tomorrow.</p>

  <p class="define"><span class="define__term">Tiebreaker</span> A unique column added to the end of an
  <code>ORDER BY</code> to turn a partial order into a total one. The primary key is almost always the
  right choice.</p>

  <p>Twelve payments sorted by status, four in each — so within a status, nothing in the
  <code>ORDER BY</code> says which comes first. Two orderings, both of which satisfy
  <code>ORDER BY Status</code>:</p>

  <pre data-lang="console" data-title="02-stable-ordering.cs output"><code>     plan A   PAY-001 PAY-004 PAY-007 PAY-010 PAY-003 PAY-006 ...
     plan B   PAY-010 PAY-007 PAY-004 PAY-001 PAY-012 PAY-009 ...

     page 1   PAY-001 PAY-004 PAY-007 PAY-010 PAY-003
     page 2   PAY-009 PAY-006 PAY-003 PAY-011 PAY-008
     page 3   PAY-008 PAY-011

   rows seen        12
   distinct         9
   seen twice       PAY-003 PAY-011 PAY-008
   never seen       PAY-002 PAY-005 PAY-012</code></pre>

  <p><strong>Nothing was inserted or deleted.</strong> The table did not change at all — the only thing
  that changed was which of two equally correct orderings the engine produced.</p>

  <p>An <code>ORDER BY</code> on a non-unique column does not define an order. It defines a partial
  order, and every arrangement of the tied rows satisfies it. What makes the engine pick differently,
  none of which is under your control: a different execution plan chosen from statistics that update as
  the table grows; a parallel scan, where the order rows arrive depends on which worker finished first;
  an index added by somebody else; a version upgrade of the database. The last one is why this fails in
  production having worked for two years.</p>

  <div class="callout callout--note">
    <h4>Note</h4>
    <p>That file had to model the two plans by hand. LINQ's <code>OrderBy</code> is documented as
    <strong>stable</strong> — ties keep their input order — so it will not produce this on its own. SQL
    <code>ORDER BY</code> carries no such guarantee, and assuming it does is the mistake.</p>
  </div>

  <pre data-lang="sql" data-title="02-stable-ordering.cs — the fix, which is one column"><code>ORDER BY Status, Id</code></pre>

  <pre data-lang="console" data-title="02-stable-ordering.cs output"><code>     starting from one order    PAY-001 PAY-004 PAY-007 PAY-010 PAY-003 ...
     starting from another      PAY-001 PAY-004 PAY-007 PAY-010 PAY-003 ...
     identical                  True</code></pre>

  <p>Adding a unique column makes the order <em>total</em>, so there is exactly one arrangement that
  satisfies it and no plan can choose differently.</p>

  <p><strong>Every paged query orders by something unique, always.</strong> Not "when the sort column
  has duplicates" — always, because a column without duplicates today is one insert away from having
  them. The primary key is the obvious tiebreaker: unique by definition, already indexed, stable.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p><code>CreatedAt</code> is not a substitute, and it is the commonest near-miss. Two payments
    created in the same millisecond share a timestamp, and a batch insert creates hundreds of them. A
    nearly-unique column is the same as a non-unique one for this purpose.</p>
    <p>The tiebreaker also has to be in the index. <code>ORDER BY Status, Id</code> over an index on
    <code>Status</code> alone still works — by reading and sorting every matching row. The index you
    want covers the whole <code>ORDER BY</code>, in that order.</p>
  </div>
</section>

<section id="contracts">
  <h2>What the caller is allowed to ask for</h2>

  <p><code>?sort=amountMinor</code> is a reasonable feature request. The way it is usually built is to
  pass the string through to the query:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - reaches any property by name"><code>PropertyInfo? property = typeof(Row).GetProperty(sort,
    BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);

Row[] sorted = [.. rows.OrderBy(r =&gt; property.GetValue(r))];</code></pre>

  <pre data-lang="console" data-title="02-stable-ordering.cs output"><code>   caller sends           reflection-based sort        allow-listed sort
   ------------           ---------------------        -----------------
   ?sort=AmountMinor      sorted by AmountMinor        sorted by amountminor, then id
   ?sort=Status           sorted by Status             sorted by status, then id
   ?sort=InternalRiskScore  sorted by InternalRiskScore  400: unknown sort field
   ?sort=Nonsense         ArgumentException -&gt; 500     400: unknown sort field</code></pre>

  <p><code>InternalRiskScore</code> is a real property on the row, never exposed in any response, and
  the reflection-based sort happily orders by it.</p>

  <p><strong>That is an information leak, and it does not need the value to be returned.</strong> A
  caller who can order by a hidden column can read it: sort ascending, sort descending, compare the two
  orderings, and the relative risk score of every payment is known. It is the same shape as an injection
  vulnerability without any SQL being concatenated — the caller supplied a name and the server used it
  to reach something.</p>

  <p>The fourth row is the second problem: a name that matches nothing throws, which becomes a 500. A
  caller can produce server errors at will, and your error rate is now controlled by whoever is
  typing.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs — the allow-list"><code>public static readonly Dictionary&lt;string, Func&lt;Payment, IComparable&gt;&gt; Sorts =
    new(StringComparer.OrdinalIgnoreCase)
    {
        ["createdAt"] = p =&gt; p.CreatedAt,
        ["amountMinor"] = p =&gt; p.AmountMinor
    };</code></pre>

  <p>The names in it are part of your API and the property names are not, which is the second thing it
  buys: renaming a property stops being a breaking change for callers who sort by it.</p>

  <h3>Filters, plus one more consideration</h3>

  <p class="define"><span class="define__term">Leading wildcard</span> A pattern that does not start
  with a known prefix — <code>LIKE '%INV%'</code>. An index is sorted by value, so it can find
  everything starting with "INV" and cannot find everything containing it. This one property decides
  which text filters are cheap.</p>

  <p>A filter has everything a sort has, and one thing more: <strong>some filters are cheap and some are
  not, and the caller cannot tell which.</strong></p>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Filter</th><th>What it costs against a real table</th></tr></thead>
      <tbody>
        <tr><td><code>status eq 'captured'</code></td><td>An index seek, if Status is indexed</td></tr>
        <tr><td><code>createdAt</code> between two dates</td><td>A range scan on an indexed column</td></tr>
        <tr><td><code>reference contains 'INV'</code></td>
            <td><strong>A full scan</strong> — no index can help a leading wildcard</td></tr>
        <tr><td><code>description</code> matches a regex</td><td>A full scan, and per-row regex work</td></tr>
        <tr><td><code>customer.address.city eq 'London'</code></td><td>A join, and possibly two</td></tr>
      </tbody>
    </table>
  </div>

  <p>The third and fourth rows are the ones that take a database down, and they look exactly as innocent
  as the first two from the client side. <code>?reference=INV</code> is 14 characters and a table
  scan.</p>

  <p>A filter contract has to state four things: <strong>which fields</strong> are filterable;
  <strong>which operators</strong> each field supports, because <code>contains</code> on an indexed
  column is not the same offer as <code>equals</code>; <strong>how many</strong> may be combined,
  because ten ORs is a different query plan from one; and <strong>what happens to an unrecognised
  one</strong>.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - an unknown filter silently does nothing"><code>IQueryable&lt;Payment&gt; query = db.Payments;

// A caller sending ?statuss=captured - or ?status=refunded, which is not a
// status - gets every payment, and believes the list was filtered.
if (filters.TryGetValue("status", out string? status))
{
    query = query.Where(p =&gt; p.Status == status);
}

return await query.Take(pageSize).ToListAsync();</code></pre>

  <p>That last deserves its own sentence. <strong>Ignoring an unknown filter is the worst available
  behaviour</strong> — it is silent, it returns more data rather than less, and the caller has no way to
  detect it. For a permissions-shaped filter it is a disclosure.</p>

  <p><strong>The set of queries a caller can cause you to run is part of your API, whether you designed
  it or not.</strong> An allow-list is how you make that set finite and known.</p>
</section>

<section id="production">
  <h2>Realistic production example</h2>

  <p>One list endpoint with every decision made:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>app.MapGet("/v1/payments", (string? cursor, int? pageSize, string? status, string? sort) =&gt;
{
    const int DefaultPageSize = 25;
    const int MaxPageSize = 100;

    // 1. THE PAGE SIZE IS BOUNDED, and out-of-range is rejected rather than
    //    clamped - a caller who asked for 500 and got 100 believes they have
    //    everything.
    int size = pageSize ?? DefaultPageSize;

    if (size &lt; 1 || size &gt; MaxPageSize)
    {
        return Results.Problem(
            title: $"pageSize must be between 1 and {MaxPageSize}",
            detail: $"You asked for {size}.",
            statusCode: 400);
    }

    // 2. FILTERS COME FROM AN ALLOW-LIST. An unrecognised value is a 400
    //    naming it, never an ignored filter - which would return unfiltered
    //    data to somebody who believes it was filtered.
    IEnumerable&lt;Payment&gt; query = table;

    if (status is not null)
    {
        if (!Allowed.Statuses.Contains(status))
        {
            return Results.Problem(
                title: "Unknown status filter",
                detail: $"'{status}' is not a status. Use: {string.Join(", ", Allowed.Statuses)}.",
                statusCode: 400);
        }

        query = query.Where(p =&gt; p.Status == status);
    }

    // 3. THE SORT FIELD COMES FROM AN ALLOW-LIST TOO, so a caller cannot
    //    order by a column no response contains.
    string sortField = sort ?? "createdAt";

    if (!Allowed.Sorts.TryGetValue(sortField, out Func&lt;Payment, IComparable&gt;? key))
    {
        return Results.Problem(
            title: "Unknown sort field",
            detail: $"'{sortField}' cannot be sorted on. Use: {string.Join(", ", Allowed.Sorts.Keys)}.",
            statusCode: 400);
    }

    // 4. THE ORDER IS TOTAL. The tiebreaker is the primary key, so no two
    //    rows compare equal and no plan can reorder them.
    IOrderedEnumerable&lt;Payment&gt; ordered = query
        .OrderByDescending(key)
        .ThenByDescending(p =&gt; p.Id, StringComparer.Ordinal);

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
            .Where(p =&gt;
            {
                int compare = string.CompareOrdinal(Cursor.KeyOf(p, sortField), afterKey);

                return compare &lt; 0
                    || (compare == 0 &amp;&amp; string.CompareOrdinal(p.Id, afterId) &lt; 0);
            })
            .OrderByDescending(key)
            .ThenByDescending(p =&gt; p.Id, StringComparer.Ordinal);
    }

    // 6. FETCH ONE MORE THAN ASKED FOR. That extra row answers 'is there
    //    another page' without a COUNT(*) over the whole filtered set.
    List&lt;Payment&gt; window = [.. ordered.Take(size + 1)];

    bool hasMore = window.Count &gt; size;
    List&lt;Payment&gt; items = [.. window.Take(size)];

    return Results.Ok(new
    {
        items = items.Select(p =&gt; new { p.Id, p.Status, p.AmountMinor, p.CreatedAt }),
        hasMore,
        nextCursor = hasMore &amp;&amp; items.Count &gt; 0
            ? Cursor.Encode(Cursor.KeyOf(items[^1], sortField), items[^1].Id)
            : null
    });
});</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>1. Walking the whole table with a cursor

   page 1   100 items   hasMore True    first PAY-0250   last PAY-0151
   page 2   100 items   hasMore True    first PAY-0150   last PAY-0051
   page 3    50 items   hasMore False   first PAY-0050   last PAY-0001

   rows seen        250
   distinct         250
   duplicated       0
   of the first 250 payments, missed   0

2. What it refuses

   request                              response
   -------                              --------
   ?pageSize=25                         200, 25 items
   ?pageSize=500                        400: pageSize must be between 1 and 100
   ?pageSize=0                          400: pageSize must be between 1 and 100
   ?status=captured                     200, 25 items
   ?status=refunded                     400: Unknown status filter
   ?sort=amountMinor                    200, 25 items
   ?sort=internalRiskScore              400: Unknown sort field
   ?cursor=not-a-cursor                 400: Malformed cursor</code></pre>

  <p>Three rows were inserted during that walk and none of them disturbed it. Every rejection names the
  thing that was wrong and lists what is allowed, so a caller integrating against this fixes it once,
  from the response, without reading anything.</p>

  <p>Note what is absent from the response shape: no page number, no total, no page count. Each of those
  is a promise about a snapshot that does not exist, and every one costs a query to keep.
  <code>hasMore</code> comes from fetching <code>pageSize + 1</code> rows and returning
  <code>pageSize</code> of them — one extra row instead of a <code>COUNT(*)</code> over the whole
  filtered set.</p>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The reconciliation job in the opening was correct on the day it was written and stayed correct for
    eighteen months. What changed was the volume:</p>
    <pre data-lang="console" data-title="03-production.cs output"><code>   payments in the window   arrivals during the run   missed per night
   ----------------------   -----------------------   ----------------
                      500                         0                  0
                      500                         2                  3
                    2,000                         5                  7
                    5,000                        20                128
                   20,000                        60               2465</code></pre>
    <p>The first row is a correct job, and it is the row every test is written against: a small fixture,
    no concurrent writes, one page or two. Nothing about the code changed between the first row and the
    last — the business grew, the batch got bigger, and a defect that had always been there started
    producing numbers.</p>
    <p>At 20,000 payments a night, 2,465 of them go unreconciled and the job reports success. That is
    not a performance problem or a nuisance; it is a financial control that does not work, and the
    number grows with the business.</p>
  </div>
</section>

<section id="closed-windows">
  <h2>The fix that keyset paging is not</h2>

  <p>Read the third and fourth rows of the incident table again:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   ORDER BY CreatedAt, Id, keyset               5009       13                0
   keyset over a CLOSED window                  5000        0                0</code></pre>

  <p><strong>The keyset row fixes the duplicates and not the misses</strong>, and that is the most
  useful thing in this module.</p>

  <p>A cursor says "everything after this row". A payment that arrives while the job is running, with a
  timestamp <em>earlier</em> than where the walk has reached — a retried write, a delayed batch, a clock
  difference between two application servers — lands behind the cursor and is never returned.</p>

  <p class="define"><span class="define__term">Closed window</span> A range whose end is already in the
  past, so nothing new can be created inside it. <code>createdAt &gt;= yesterday AND createdAt &lt;
  today</code>, run after midnight.</p>

  <p><strong>Keyset paging is not a fix for a moving window.</strong> It is a fix for positions moving
  underneath you, which is a different problem, and it is the one that produces duplicates. The window
  is the correctness fix; the cursor is the performance fix that also removes duplicates.</p>

  <p>Note the order of those two ideas, because it is the opposite of the order people reach for them. A
  job that processes a closed window with offset paging is still slow and still correct.</p>

  <pre data-lang="sql" data-title="03-production.cs — the query, fixed"><code>SELECT * FROM Payments
WHERE CreatedAt &gt;= @from AND CreatedAt &lt; @to
  AND (CreatedAt, Id) &gt; (@lastCreatedAt, @lastId)
ORDER BY CreatedAt, Id
FETCH NEXT 500 ROWS ONLY

CREATE INDEX IX_Payments_CreatedAt_Id ON Payments (CreatedAt, Id)</code></pre>

  <p>Three changes: a unique ordering, a cursor instead of an offset, and a comparison on the
  <em>pair</em> rather than on <code>CreatedAt</code> alone — which is what makes it correct across a
  batch of rows sharing a timestamp. The index has to match, or the ordering is done by sorting every
  matching row.</p>

  <h3>And the verification, which was the part actually missing</h3>

  <pre data-lang="sql" data-title="03-production.cs"><code>SELECT COUNT(*) FROM Payments WHERE CreatedAt &gt;= @from AND CreatedAt &lt; @to</code></pre>

  <pre data-lang="console" data-title="03-production.cs output"><code>     payments in the window, counted separately   5,000
     payments the job reconciled                  5,000
     difference                                   0</code></pre>

  <p>A separate count is the only thing that catches this class of bug. It is one extra query, it does
  not page, and it is <strong>computed by a different mechanism from the walk</strong> — which is the
  entire point. If the two disagree, the job fails loudly.</p>

  <p>It only works against a closed window, because a count taken while rows are still arriving is
  allowed to disagree. That constraint is the same one that made the job correct, arriving from a
  different direction.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Ordering by a non-unique column</h3>

  <p>Measured above: three rows duplicated and three never seen, from a table that did not change. The
  fix is a unique tiebreaker in every paged <code>ORDER BY</code>, without exception.</p>

  <h3>Trusting a page number across requests</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a position in a list that is moving"><code>app.MapGet("/v1/payments", (int page = 1, int pageSize = 10) =&gt; Results.Ok(new
{
    page,
    pageSize,
    total = payments.Count,
    items = payments.Skip((page - 1) * pageSize).Take(pageSize)
}));</code></pre>

  <h3>Letting the caller set the page size</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   ?pageSize=       unbounded            bounded
   ----------       ---------            -------
   (omitted)        200, 20 rows         200, 20 rows
   pageSize=500     200, 500 rows        400
   pageSize=1000000  200, 5000 rows       400
   pageSize=0       200, 0 rows          400
   pageSize=-1      200, 0 rows          400</code></pre>

  <p>Three decisions have to be made: a <strong>default</strong> for the caller who says nothing, small
  enough that an accidental unbounded read is cheap; a <strong>maximum</strong>, which is what stops one
  request reading the table; and a <strong>minimum</strong>, because 0 and −1 are values a caller can
  send.</p>

  <p>Note what the unbounded column does with 0 and −1: 200 and zero rows, silently.
  <code>Take(-1)</code> does not throw — so a client looping until a short page arrives terminates
  immediately having read no data and seen no error.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Reject rather than clamp. Silently returning 100 rows to a caller who asked for 5,000 means they
    believe they have everything, and a client that loops "until fewer than pageSize rows come back"
    terminates immediately with 2% of the data. A 400 naming the maximum is one line to read and one
    line to fix.</p>
  </div>

  <h3>Reflecting over a caller-supplied sort field</h3>

  <p>Measured above: a hidden column becomes sortable, and an unknown one becomes a 500 the caller
  controls.</p>

  <h3>Ignoring an unrecognised filter</h3>

  <p>It is silent, it returns <em>more</em> data rather than less, and the caller believes the filter
  was applied. For anything permissions-shaped that is a disclosure rather than a bug.</p>

  <h3>Decoding a cursor without validating it</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - caller-supplied input, straight into a query"><code>// Whatever the caller sent, split on a character and used as a sort key.
// A malformed cursor is an unhandled exception; a crafted one is a WHERE
// clause the caller wrote.
string[] parts = Encoding.UTF8
    .GetString(Convert.FromBase64String(cursor))
    .Split('|');

query = query.Where(p =&gt; p.CreatedAt &lt; DateTime.Parse(parts[0]));</code></pre>

  <p>A cursor is caller-supplied input like any other. It has to be decoded inside a
  <code>try</code>, checked for shape, and rejected with a 400 rather than throwing — the same
  treatment a sort field gets, for the same reason.</p>

  <h3>Returning a total count nobody asked for</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a second query as expensive as the page"><code>return Results.Ok(new
{
    items = query.Skip(offset).Take(size).ToList(),

    // Over 40 million filtered rows this cannot stop early, and every
    // caller pays for it whether or not they display it.
    total = query.Count()
});</code></pre>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="table-wrap">
    <table>
      <thead><tr><th>Symptom</th><th>Likely cause</th><th>Check</th></tr></thead>
      <tbody>
        <tr><td>A duplicate in an export</td><td>Offset paging over a table receiving inserts</td>
            <td>Whether rows were created between the two page requests</td></tr>
        <tr><td>A job's count disagrees with an external count</td>
            <td>Rows skipped by offset paging, or an unstable order</td>
            <td>Count separately, over a closed window</td></tr>
        <tr><td>Paging works in test and not in production</td>
            <td>A non-unique sort column plus a different execution plan</td>
            <td>Whether the <code>ORDER BY</code> ends in a unique column</td></tr>
        <tr><td>Deep pages time out, shallow ones are instant</td>
            <td>Offset cost is proportional to the offset</td>
            <td>The query plan for a deep page</td></tr>
        <tr><td>One caller's requests dominate the database</td>
            <td>Unbounded page size, or an unindexed filter</td>
            <td>The maximum page size, and which filters the allow-list permits</td></tr>
        <tr><td>A filter appears to do nothing</td>
            <td>An unrecognised filter name, silently ignored</td>
            <td>Whether unknown filters are rejected</td></tr>
      </tbody>
    </table>
  </div>

  <div class="callout callout--debug">
    <h4>How to debug it</h4>
    <p>For "is this walk complete", the only reliable check is a count computed a different way, over a
    range that has stopped changing. Anything the walk computes about itself inherits the walk's bug:</p>
    <pre data-lang="csharp" data-net="10" data-title="the assertion a paging job needs"><code>// The walk.
List&lt;string&gt; seen = await WalkAsync(from, to);

// Computed independently, and over a CLOSED window so it is allowed to match.
int expected = await CountAsync(from, to);

if (seen.Distinct().Count() != expected)
{
    throw new InvalidOperationException(
        $"walked {seen.Distinct().Count()} rows, expected {expected}");
}</code></pre>
    <p>To reproduce a paging bug locally, the fixture needs the property production has and test
    fixtures never do: <strong>rows arriving while the walk runs</strong>. Insert a row between page
    requests in the test itself. Without that, offset paging passes every test it will ever be given.</p>
    <p>And to tell a skipped row from a deleted one, keep the ids: the difference between "rows that
    existed and were not returned" and "rows that were removed" is the difference between a bug and
    correct behaviour, and only the first is worth investigating.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Offset paging is fine once the ordering is fixed."</strong></p>
    <p>Measured false: adding the unique tiebreaker to the incident's query left it missing exactly as
    many rows. Unstable ordering and offset drift are two independent defects with the same symptom.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Keyset paging makes the walk complete."</strong></p>
    <p>It removes duplicates and it cannot show you a row inserted behind the cursor. Completeness comes
    from walking a window that has stopped changing.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"ORDER BY CreatedAt is unique enough — timestamps have milliseconds."</strong></p>
    <p>A batch insert writes hundreds of rows with the same timestamp. Nearly unique is not unique, and
    the tied rows are exactly where page boundaries land.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"OFFSET 500000 jumps straight to row 500,000."</strong></p>
    <p>There is nothing to jump to. The engine produces half a million rows in sorted order and discards
    them, which is why the cost grows with the offset and not with the page size.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Clamping an oversized page size is friendlier than rejecting it."</strong></p>
    <p>It is silent, and it breaks the standard client loop: a caller asking for 5,000 and receiving 100
    concludes there were only 100. A 400 naming the maximum is unambiguous.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Returning a total is free, we already have the query."</strong></p>
    <p>The page can stop as soon as it has enough rows; a count cannot. Over a large filtered set the
    count is usually the more expensive of the two, and every caller pays for it whether they display it
    or not.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>The two failures in this module have different shapes and both are quiet.</p>
    <p><strong>The correctness one compounds with growth.</strong> At 500 payments a night the
    reconciliation missed none; at 20,000 it missed 2,465, from identical code. Nobody changed anything —
    a defect that had always been there crossed the threshold where it produced numbers, and the number
    it produced was invisible because the job counted only what it saw.</p>
    <p><strong>The cost one is a denial of service with a friendly interface.</strong>
    <code>?pageSize=1000000</code> and <code>?page=50000</code> are both short, both look like ordinary
    paging, and both ask the database to do work bounded by nothing. A crawler that walks every page of
    a list screen will find the deep ones, and it will not be doing it deliberately.</p>
    <p>The whole module reduces to one decision with two consequences: <strong>the caller names a row
    rather than a position, and the server decides how much work a request is worth.</strong> Everything
    else — the tiebreaker, the bounds, the allow-lists, the absent count — follows from those two.</p>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A customer exports their payments to a spreadsheet. The export pages through the API 100 at a
    time, newest first, and the spreadsheet has one payment listed twice. The export code is correct and
    the API is correct.</p>
    <p>What happened?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   page   first row   last row    new arrivals before the next page
   ----   ---------   --------    ---------------------------------
      1   PAY-300     PAY-201     3
      2   PAY-203     PAY-104     3
      3   PAY-106     PAY-007     0

   rows in the spreadsheet   300
   distinct                  294
   listed twice              PAY-203, PAY-202, PAY-201, PAY-106, PAY-105, PAY-104</code></pre>
        <p>Three payments arrived between page 1 and page 2, and three more between page 2 and page 3.
        Each arrival pushed the whole list down by one, so each page started earlier than the caller
        intended and repeated rows it had already returned.</p>
        <p>Neither side is wrong. The export asked for rows 100–200 and got rows 100–200 — of a list
        that had six more rows at the top than when page 1 was fetched.</p>
        <p>The fix is to stop describing a position. A cursor naming the last row seen is immune to
        inserts above it, because a row does not move when other rows are added.</p>
        <p>The wider lesson: offset paging is a snapshot API over something that is not a snapshot. Fine
        for a screen a person is reading; wrong for anything that has to be complete.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>An admin screen lists payments with numbered pages. It was instant at launch. Two years later
    page 1 is instant, page 50 is fine, and page 4,000 times out.</p>
    <p>Explain the shape, and give two fixes with their costs.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   page      offset     rows the engine must produce and discard
   ----      ------     ----------------------------------------
      1           0              100
     50       4,900            5,000
    500      49,900           50,000
   4000     399,900          400,000</code></pre>
        <p>The cost of an <code>OFFSET</code> query is proportional to the offset, not to the page size.
        Page 4,000 asks the engine to produce 399,900 rows in sorted order and throw them away before
        returning 100. It got slower every month because the offsets got bigger; nothing about the query
        changed.</p>
        <p><strong>Fix one: keyset paging.</strong> Constant cost at any depth. The cost is that numbered
        pages go away — a cursor can go next and previous and cannot jump to page 4,000, because "page
        4,000" is not a thing that exists without counting.</p>
        <p><strong>Fix two: cap the depth.</strong> Keep offset paging, reject anything past page 100,
        and tell the caller to filter. The cost is that a screen which genuinely needed page 4,000 cannot
        show it.</p>
        <p>Which to choose depends on a question about people rather than code: does anybody actually go
        to page 4,000? Almost always the traffic is a crawler, or somebody who wanted a search and used
        the only tool on the screen. And if somebody genuinely does page deeply — a support agent working
        a queue — they do not want page 4,000 either; they want the rows it happens to contain, which is
        a filter with a different name.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>An endpoint takes <code>?pageSize=</code> and passes it to <code>Take()</code>. Design the
    handling, and say what each rejected case should return.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="csharp" data-net="10" data-title="04-exercises.cs"><code>const int Default = 20;
const int Max = 100;

int requested = pageSize ?? Default;

if (requested &lt; 1)
{
    return Results.Problem(title: "pageSize must be at least 1", statusCode: 400);
}

if (requested &gt; Max)
{
    return Results.Problem(
        title: $"pageSize must be at most {Max}",
        detail: $"You asked for {requested}. Use a cursor to read more than {Max} rows.",
        statusCode: 400);
}</code></pre>
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   ?pageSize=       unbounded            bounded
   ----------       ---------            -------
   (omitted)        200, 20 rows         200, 20 rows
   pageSize=500     200, 500 rows        400
   pageSize=1000000  200, 5000 rows       400
   pageSize=0       200, 0 rows          400
   pageSize=-1      200, 0 rows          400</code></pre>
        <p>Three decisions, and all three have to be made: a default for the caller who says nothing, a
        maximum that stops one request reading the table, and a minimum because 0 and −1 are values a
        caller can send.</p>
        <p>Note what the unbounded column does with those last two: 200 and zero rows, silently.
        <code>Take(-1)</code> does not throw, so a client looping until a short page arrives terminates
        immediately having read no data and seen no error.</p>
        <p>Reject rather than clamp. Silently returning 100 rows to a caller who asked for 5,000 means
        they believe they have everything.</p>
        <p>And note the unbounded row for <code>?pageSize=1000000</code>: every row in the table, from a
        request 22 characters long.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>Design paging, filtering and sorting for <code>GET /v1/payments</code>, given a customer-facing
    list screen with next/previous, a nightly export that must see every payment exactly once, a support
    tool that filters by status and date, and a table with 40 million rows.</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>One scheme: keyset, for everybody.</strong> The export needs it for correctness and
        the screen needs it for speed at 40 million rows. Two schemes would be two code paths, two sets
        of tests, and a question about which one a given caller is on. The screen loses numbered pages,
        which is a real cost and almost always acceptable — a list with 40 million rows behind it has no
        meaningful page 200,000.</p>
        <p><strong>The cursor is opaque</strong>, base64 of the last row's sort key. Opaque for a
        specific reason: the moment a caller can read it, the columns in it are part of your contract and
        you can never change the sort key without a version. It also has to be <em>validated</em> and not
        merely decoded — a cursor is caller-supplied input, and decoding one into a WHERE clause without
        checking it is the same mistake as a caller-supplied sort column.</p>
        <p><strong><code>ORDER BY (CreatedAt DESC, Id DESC)</code>, always</strong>, with an index to
        match. Unique, so no plan can reorder it; indexed, so no page has to sort.</p>
        <p><strong>Page size: default 25, maximum 100</strong>, reject outside that.</p>
        <p><strong>Filters from an allow-list, with operators named per field:</strong></p>
        <pre data-lang="text" data-title="the filter contract"><code>status      eq, in            indexed
createdAt   gte, lt           indexed, and the sort column
amountMinor gte, lte          indexed
reference   eq ONLY           NOT contains - a leading wildcard cannot use an index</code></pre>
        <p>An unrecognised field is a 400 naming it; ignoring it would return unfiltered data to somebody
        who believes it was filtered.</p>
        <p><strong>No total count by default.</strong> <code>COUNT(*)</code> over 40 million filtered
        rows is a second query as expensive as the page, often more, because it cannot stop early. Return
        <code>hasMore</code> instead, computed by fetching <code>pageSize + 1</code> rows. Offer an exact
        count behind an explicit <code>?includeTotal=true</code> so the cost is something a caller asks
        for rather than something every caller pays.</p>
        <p><strong>The export reads a closed window</strong> — <code>createdAt &gt;= yesterday AND
        createdAt &lt; today</code>, run after midnight, so no row can arrive inside the window while the
        walk runs. This is the correctness fix; keyset is the performance one.</p>
        <pre data-lang="json" data-title="the response shape"><code>{
  "items": [ ... 25 payments ... ],
  "hasMore": true,
  "nextCursor": "eyJjIjoi..."
}</code></pre>
        <p>Note what is absent: no page number, no total, no page count. Each is a promise about a
        snapshot that does not exist, and every one costs a query to keep. The one thing that makes all
        of it work is that the caller never describes a position — everything above is a consequence of
        that single decision.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Why does offset paging return duplicates when rows are being inserted?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An offset is a position in an ordered list. A row inserted above
        that position shifts everything down, so the next page starts earlier than intended and repeats
        rows already returned.</p></div>
      </details></li>

    <li><p>Which is worse, a duplicated row or a skipped one, and why?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A skipped row. A duplicate is visible and somebody complains;
        nothing records that a row existed and was not returned, so a job reports success having never
        seen it.</p></div>
      </details></li>

    <li><p>Why must every paged query order by something unique?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An <code>ORDER BY</code> on a non-unique column defines only a
        partial order, so the engine may arrange tied rows differently between queries — and page
        boundaries land exactly among the tied rows.</p></div>
      </details></li>

    <li><p>Why is <code>OFFSET 500000</code> expensive?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The engine has to produce 500,000 rows in sort order and discard
        them before returning any. There is no address to jump to, because the ordering is a property of
        the query rather than of the storage.</p></div>
      </details></li>

    <li><p>What does keyset paging fix, and what does it not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It fixes duplicates and deep-page cost. It does not make a walk
        complete — a row inserted behind the cursor is never returned. Completeness comes from walking a
        closed window.</p></div>
      </details></li>

    <li><p>Why should an oversized page size be rejected rather than clamped?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Clamping is silent. A caller who asked for 5,000 and received 100
        concludes there were only 100, and the standard "loop until a short page" pattern terminates with
        2% of the data.</p></div>
      </details></li>

    <li><p>What is wrong with reflecting over a caller-supplied sort field name?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It reaches any property, including ones no response contains — a
        caller can order by a hidden column and read it by comparing ascending and descending orders. An
        unknown name also throws, giving the caller control of your error rate.</p></div>
      </details></li>

    <li><p>How do you verify that a paging job saw everything?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Count the rows a different way — a single <code>COUNT(*)</code> over
        the same closed window — and fail if it disagrees with the walk. Any number the walk computes
        about itself inherits the walk's bug.</p></div>
      </details></li>
  </ol>
</section>
`
});
