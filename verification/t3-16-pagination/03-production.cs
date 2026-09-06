// 03-production.cs — The incident: a nightly reconciliation that reported
// success every night and had been missing payments for four months.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic for the traffic pattern
// described. The absolute numbers scale with write rate; the pattern does not.

#:sdk Microsoft.NET.Sdk
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

TheJob();
UnderLoad();
WhyNobodyNoticed();
TheFix();

// ---------------------------------------------------------------------------
static void TheJob()
{
    Console.WriteLine("1. The job");
    Console.WriteLine();
    Console.WriteLine("   Every night at 01:00, Ledger reconciles the day's payments against the");
    Console.WriteLine("   gateway's settlement file. It pages through the payments table:");
    Console.WriteLine();
    Console.WriteLine("     SELECT * FROM Payments");
    Console.WriteLine("     WHERE CreatedAt >= @from AND CreatedAt < @to");
    Console.WriteLine("     ORDER BY CreatedAt");
    Console.WriteLine("     OFFSET @offset ROWS FETCH NEXT 500 ROWS ONLY");
    Console.WriteLine();
    Console.WriteLine("   It has run every night for two years. It logs how many payments it");
    Console.WriteLine("   reconciled and it has never once reported an error.");
    Console.WriteLine();
    Console.WriteLine("   There are two defects in that query and they compound.");
    Console.WriteLine();
    Console.WriteLine("     ORDER BY CreatedAt IS NOT A TOTAL ORDER. Payments are written by a");
    Console.WriteLine("     batch processor, so hundreds share a timestamp to the millisecond.");
    Console.WriteLine();
    Console.WriteLine("     OFFSET COUNTS POSITIONS in a result set that is still being written");
    Console.WriteLine("     to, because 01:00 is quiet and not empty.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void UnderLoad()
{
    Console.WriteLine("2. What it actually reconciled");
    Console.WriteLine();
    Console.WriteLine("   One night's run: 5,000 payments in the window, pages of 500, and a");
    Console.WriteLine("   trickle of late arrivals landing inside the window while the job runs.");
    Console.WriteLine();

    Console.WriteLine("   query                                  reconciled   missed   double-counted");
    Console.WriteLine("   -----                                  ----------   ------   --------------");

    Report("ORDER BY CreatedAt, OFFSET", Run(tiebreaker: false, keyset: false));
    Report("ORDER BY CreatedAt, Id, OFFSET", Run(tiebreaker: true, keyset: false));
    Report("ORDER BY CreatedAt, Id, keyset", Run(tiebreaker: true, keyset: true));
    Report("keyset over a CLOSED window", Run(tiebreaker: true, keyset: true, closedWindow: true));

    Console.WriteLine();
    Console.WriteLine("   THE FIRST ROW IS THE JOB AS WRITTEN. It reported reconciling five");
    Console.WriteLine("   thousand payments and it did not reconcile all of them.");
    Console.WriteLine();
    Console.WriteLine("   THE SECOND ROW IS WHY THIS IS NOT ONE BUG. Adding the tiebreaker fixes");
    Console.WriteLine("   the unstable ordering and the job still misses rows, because OFFSET is");
    Console.WriteLine("   independently wrong when the result set is growing.");
    Console.WriteLine();
    Console.WriteLine("   Two defects, and fixing either one alone leaves a job that quietly");
    Console.WriteLine("   under-reports.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW FIXES THE DUPLICATES AND NOT THE MISSES, and that is the");
    Console.WriteLine("   most useful thing in this file.");
    Console.WriteLine();
    Console.WriteLine("   A cursor says 'everything after this row'. A payment that arrives while");
    Console.WriteLine("   the job is running, with a timestamp EARLIER than where the walk has");
    Console.WriteLine("   reached - a retried write, a delayed batch, a clock difference between");
    Console.WriteLine("   two application servers - lands behind the cursor and is never");
    Console.WriteLine("   returned.");
    Console.WriteLine();
    Console.WriteLine("   KEYSET PAGING IS NOT A FIX FOR A MOVING WINDOW. It is a fix for");
    Console.WriteLine("   positions moving underneath you, which is a different problem, and it");
    Console.WriteLine("   is the one that produces duplicates.");
    Console.WriteLine();
    Console.WriteLine("   THE FOURTH ROW IS THE ACTUAL FIX: the same query over a window whose");
    Console.WriteLine("   end is already in the past, so nothing can arrive inside it. Nothing");
    Console.WriteLine("   duplicated, nothing missed.");
    Console.WriteLine();
    Console.WriteLine("   Note the ORDER of the two ideas, because it is the opposite of the");
    Console.WriteLine("   order people reach for them: THE WINDOW IS THE CORRECTNESS FIX and the");
    Console.WriteLine("   cursor is the performance fix that also removes duplicates. A job that");
    Console.WriteLine("   processes a closed window with offset paging is still slow and still");
    Console.WriteLine("   correct.");
    Console.WriteLine();

    static void Report(string label, Outcome outcome)
    {
        Console.WriteLine($"   {label,-36}   {outcome.Reconciled,10}   {outcome.Missed,6}   " +
            $"{outcome.Duplicated,14}");
    }
}

// ---------------------------------------------------------------------------
static void WhyNobodyNoticed()
{
    Console.WriteLine("3. Four months");
    Console.WriteLine();
    Console.WriteLine("   The job was correct on the day it was written, and it was correct for");
    Console.WriteLine("   eighteen months after that. What changed was the volume.");
    Console.WriteLine();

    Console.WriteLine("   payments in the window   arrivals during the run   missed per night");
    Console.WriteLine("   ----------------------   -----------------------   ----------------");

    foreach ((int total, int arrivals) in new[]
    {
        (500, 0), (500, 2), (2_000, 5), (5_000, 20), (20_000, 60)
    })
    {
        Outcome outcome = Run(tiebreaker: false, keyset: false, total, arrivals);

        Console.WriteLine($"   {total,22:n0}   {arrivals,23}   {outcome.Missed,16}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIRST ROW IS A CORRECT JOB, and it is the row every test is written");
    Console.WriteLine("   against: a small fixture, no concurrent writes, one page or two.");
    Console.WriteLine();
    Console.WriteLine("   Nothing about the code changed between the first row and the last. The");
    Console.WriteLine("   business grew, the batch got bigger, and a defect that had always been");
    Console.WriteLine("   there started producing numbers.");
    Console.WriteLine();
    Console.WriteLine("   AND THE REPORTING MADE IT INVISIBLE. The job logs what it reconciled,");
    Console.WriteLine("   which is a number it computes from what it saw. A job that pages past a");
    Console.WriteLine("   row does not know the row existed, so THE COUNT IT REPORTS IS ITSELF");
    Console.WriteLine("   DERIVED FROM THE BUG.");
    Console.WriteLine();
    Console.WriteLine("   Every dashboard, every alert threshold and every 'reconciled 4,987");
    Console.WriteLine("   payments' log line was consistent with itself and wrong.");
    Console.WriteLine();
    Console.WriteLine("   WHAT FOUND IT, eventually: the gateway's monthly statement did not");
    Console.WriteLine("   match the ledger's. Not a log, not an alert, not a test - an external");
    Console.WriteLine("   party with an independent count.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheFix()
{
    Console.WriteLine("4. What to change, and what to add");
    Console.WriteLine();
    Console.WriteLine("   THE QUERY, which is the smaller half:");
    Console.WriteLine();
    Console.WriteLine("     SELECT * FROM Payments");
    Console.WriteLine("     WHERE CreatedAt >= @from AND CreatedAt < @to");
    Console.WriteLine("       AND (CreatedAt, Id) > (@lastCreatedAt, @lastId)");
    Console.WriteLine("     ORDER BY CreatedAt, Id");
    Console.WriteLine("     FETCH NEXT 500 ROWS ONLY");
    Console.WriteLine();
    Console.WriteLine("   Three changes: a unique ordering, a cursor instead of an offset, and a");
    Console.WriteLine("   comparison on the PAIR rather than on CreatedAt alone - which is what");
    Console.WriteLine("   makes it correct across a batch of rows sharing a timestamp.");
    Console.WriteLine();
    Console.WriteLine("   THE INDEX HAS TO MATCH, or the ordering is done by sorting every");
    Console.WriteLine("   matching row:");
    Console.WriteLine();
    Console.WriteLine("     CREATE INDEX IX_Payments_CreatedAt_Id ON Payments (CreatedAt, Id)");
    Console.WriteLine();
    Console.WriteLine("   THE VERIFICATION, which is the larger half and the part that was");
    Console.WriteLine("   actually missing:");
    Console.WriteLine();

    Outcome fixedRun = Run(tiebreaker: true, keyset: true, closedWindow: true);
    int expected = 5_000;

    Console.WriteLine($"     payments in the window, counted separately   {expected:n0}");
    Console.WriteLine($"     payments the job reconciled                  {fixedRun.Reconciled:n0}");
    Console.WriteLine($"     difference                                   {expected - fixedRun.Reconciled}");
    Console.WriteLine();
    Console.WriteLine("   A SEPARATE COUNT IS THE ONLY THING THAT CATCHES THIS. It is one extra");
    Console.WriteLine("   query, it does not page, and it is computed by a different mechanism");
    Console.WriteLine("   from the walk - which is the entire point.");
    Console.WriteLine();
    Console.WriteLine("     SELECT COUNT(*) FROM Payments WHERE CreatedAt >= @from AND CreatedAt < @to");
    Console.WriteLine();
    Console.WriteLine("   If the walk and the count disagree, the job fails loudly. Note that it");
    Console.WriteLine("   is allowed to disagree slightly if rows are still arriving - so the");
    Console.WriteLine("   check is against a CLOSED window, one whose end is in the past.");
    Console.WriteLine();
    Console.WriteLine("   THAT LAST POINT IS THE DESIGN LESSON AND IT IS BIGGER THAN PAGING:");
    Console.WriteLine();
    Console.WriteLine("     A BATCH JOB SHOULD PROCESS A WINDOW THAT HAS STOPPED CHANGING.");
    Console.WriteLine();
    Console.WriteLine("   Reconciling 'today so far' means reconciling a moving target, and every");
    Console.WriteLine("   paging scheme has to cope with rows arriving mid-walk. Reconciling");
    Console.WriteLine("   'yesterday, which is closed' means the result set is fixed for the");
    Console.WriteLine("   duration of the job, and the hardest class of bug in this module cannot");
    Console.WriteLine("   occur at all.");
    Console.WriteLine();
    Console.WriteLine("   KEYSET PAGING IS STILL RIGHT for a closed window - it is faster at");
    Console.WriteLine("   depth and it costs nothing extra - but it is a second line of defence");
    Console.WriteLine("   rather than the only one.");
    Console.WriteLine();
    Console.WriteLine("   THE CHECKLIST THIS INCIDENT PRODUCES:");
    Console.WriteLine();
    Console.WriteLine("     - process closed windows, not open ones - this is the one that");
    Console.WriteLine("       makes the job correct, and the only one that does;");
    Console.WriteLine("     - order by something unique, always;");
    Console.WriteLine("     - page by cursor for anything a machine walks;");
    Console.WriteLine("     - count separately and fail if the counts disagree;");
    Console.WriteLine("     - and never trust a number the buggy path computed about itself.");
}

// ---------------------------------------------------------------------------
static Outcome Run(bool tiebreaker, bool keyset, int total = 5_000, int arrivalsPerPage = 2,
    bool closedWindow = false)
{
    var table = new List<Payment>();
    var window = (From: new DateTime(2026, 1, 1), To: new DateTime(2026, 1, 2));

    // The day's payments, written in batches - so hundreds share a timestamp,
    // which is what a batch processor does.
    for (int n = 1; n <= total; n++)
    {
        // 250 payments per batch, one batch per minute.
        DateTime created = window.From.AddMinutes((n - 1) / 250);

        table.Add(new Payment($"PAY-{n:00000}", created));
    }

    var reconciled = new List<string>();
    (DateTime CreatedAt, string Id)? cursor = null;
    int offset = 0;
    int late = 0;

    while (true)
    {
        IEnumerable<Payment> query = table
            .Where(p => p.CreatedAt >= window.From && p.CreatedAt < window.To);

        query = tiebreaker
            ? query.OrderBy(p => p.CreatedAt).ThenBy(p => p.Id, StringComparer.Ordinal)
            : Unstable(query);

        if (keyset && cursor is { } last)
        {
            query = query.Where(p =>
                p.CreatedAt > last.CreatedAt
                || (p.CreatedAt == last.CreatedAt
                    && string.CompareOrdinal(p.Id, last.Id) > 0));
        }
        else if (!keyset)
        {
            query = query.Skip(offset);
        }

        List<Payment> page = [.. query.Take(500)];

        if (page.Count == 0)
        {
            break;
        }

        reconciled.AddRange(page.Select(p => p.Id));

        cursor = (page[^1].CreatedAt, page[^1].Id);
        offset += 500;

        // Late arrivals: payments reaching the database while the job runs.
        //
        // With an OPEN window they land inside it, at whatever time they were
        // created - which for a retried or delayed write is BEHIND the point
        // the walk has reached.
        //
        // With a CLOSED window - one whose end is already in the past - a new
        // arrival belongs to the next window and cannot appear in this one.
        for (int i = 0; i < arrivalsPerPage; i++)
        {
            late++;

            DateTime created = closedWindow
                ? window.To.AddMinutes(late)
                : window.From.AddMinutes(late % 20);

            table.Add(new Payment($"LATE-{late:000}", created));
        }
    }

    string[] shouldHaveSeen = [.. table
        .Where(p => p.CreatedAt >= window.From && p.CreatedAt < window.To)
        .Select(p => p.Id)];

    return new Outcome(
        Reconciled: reconciled.Distinct().Count(),
        Missed: shouldHaveSeen.Except(reconciled).Count(),
        Duplicated: reconciled.Count - reconciled.Distinct().Count());
}

// Models a database's freedom to return tied rows in any order: rows sharing a
// timestamp come back in an order that varies between queries. LINQ's OrderBy
// is stable and will not do this on its own.
static IEnumerable<Payment> Unstable(IEnumerable<Payment> source)
{
    int seed = Interlocked.Increment(ref Plan.Counter);

    return source
        .OrderBy(p => p.CreatedAt)
        .ThenBy(p => (p.Id.GetHashCode() ^ seed) & 0xFFFF);
}

static class Plan
{
    public static int Counter;
}

// ---------------------------------------------------------------------------
record Payment(string Id, DateTime CreatedAt);

record Outcome(int Reconciled, int Missed, int Duplicated);
