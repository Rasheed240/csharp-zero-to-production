// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every count and occurrence here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Hangfire.Core@1.8.21
#:package Hangfire.InMemory@1.0.0
#:package Newtonsoft.Json@13.0.4
#:package Cronos@0.11.0

using Cronos;
using Hangfire;
using Hangfire.Common;
using Hangfire.InMemory;
using Hangfire.States;

One();
Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static void One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the report that arrives an hour late for half the year");
    Console.WriteLine();
    Console.WriteLine("   A daily sales report is scheduled with '0 9 * * *' and is meant to be");
    Console.WriteLine("   in inboxes by nine. From late March to late October it arrives at ten.");
    Console.WriteLine("   The schedule has not been touched.");
    Console.WriteLine();

    CronExpression cron = CronExpression.Parse("0 9 * * *");
    TimeZoneInfo london = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");

    (string Label, DateTimeOffset From)[] dates =
    [
        ("January (GMT)", new DateTimeOffset(2027, 1, 15, 0, 0, 0, TimeSpan.Zero)),
        ("July (BST)", new DateTimeOffset(2027, 7, 15, 0, 0, 0, TimeSpan.Zero))
    ];

    Console.WriteLine("   date            scheduled in UTC      that is, in London");
    Console.WriteLine("   ----            ----------------      ------------------");

    foreach ((string label, DateTimeOffset from) in dates)
    {
        DateTime utc = cron.GetNextOccurrence(from.UtcDateTime)!.Value;

        Console.WriteLine($"   {label,-15} {utc:yyyy-MM-dd HH:mm} UTC     " +
            $"{TimeZoneInfo.ConvertTimeFromUtc(utc, london):HH:mm} local");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE SCHEDULE IS IN UTC AND THE EXPECTATION IS IN LOCAL TIME.");
    Console.WriteLine("   Nine o'clock UTC is nine o'clock in London in January and ten o'clock");
    Console.WriteLine("   in July, because London is an hour ahead of UTC in summer.");
    Console.WriteLine();
    Console.WriteLine("   NOTHING CHANGED IN MARCH. The schedule was always UTC; the clocks moved");
    Console.WriteLine("   underneath it. Which is why this is reported as 'it started happening'");
    Console.WriteLine("   rather than 'it has always been wrong' - the bug was introduced on the");
    Console.WriteLine("   day the job was written and became visible on the last Sunday of");
    Console.WriteLine("   March.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS TO SAY WHICH NINE O'CLOCK YOU MEANT:");
    Console.WriteLine();
    Console.WriteLine("     RecurringJob.AddOrUpdate(\"daily-report\", () => Reports.SendDaily(),");
    Console.WriteLine("         \"0 9 * * *\", new RecurringJobOptions");
    Console.WriteLine("         {");
    Console.WriteLine("             TimeZone = TimeZoneInfo.FindSystemTimeZoneById(\"Europe/London\")");
    Console.WriteLine("         });");
    Console.WriteLine();
    Console.WriteLine("   AND THE RULE THAT PREVENTS THE WHOLE CLASS: A CRON EXPRESSION WITHOUT A");
    Console.WriteLine("   TIME ZONE IS AN INCOMPLETE INSTRUCTION. Write the zone every time, even");
    Console.WriteLine("   when it is UTC, so that the next person can tell the difference between");
    Console.WriteLine("   'UTC was chosen' and 'nobody thought about it'.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the deploy that broke jobs already queued");
    Console.WriteLine();
    Console.WriteLine("   A release renames SendInvoice to SendInvoiceAsync and adds a parameter.");
    Console.WriteLine("   Tests pass. After the deploy, several hundred jobs fail immediately");
    Console.WriteLine("   with errors that mention no business logic at all.");
    Console.WriteLine();

    JobStorage.Current = new InMemoryStorage();

    // A job enqueued by the OLD version of the code.
    string id = BackgroundJob.Enqueue(() => OldVersion.SendInvoice("ACC-001"));

    // The NEW version tries to load it. The stored row still names the old
    // method on the old type.
    string outcome;

    try
    {
        var storage = JobStorage.Current.GetConnection();
        Hangfire.Storage.JobData data = storage.GetJobData(id);

        // Deserialisation succeeded only because the old type still exists in
        // this file. Ask for the method the new version would look for.
        Job stored = data.Job!;

        System.Reflection.MethodInfo? renamed = typeof(NewVersion)
            .GetMethod(stored.Method.Name);

        outcome = renamed is null
            ? $"the new assembly has no method called '{stored.Method.Name}'"
            : "found";
    }
    catch (Exception exception)
    {
        outcome = exception.GetType().Name;
    }

    Console.WriteLine($"   what the stored job names        {typeof(OldVersion).Name}.SendInvoice(\"ACC-001\")");
    Console.WriteLine($"   what the new version provides    {typeof(NewVersion).Name}.SendInvoiceAsync(string, string)");
    Console.WriteLine($"   result                           {outcome}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: A QUEUED JOB IS A MESSAGE TO A FUTURE VERSION OF YOUR CODE, and");
    Console.WriteLine("   the message says a type name, a method name and an argument list. The");
    Console.WriteLine("   deployment changed all three.");
    Console.WriteLine();
    Console.WriteLine("   THE COMPILER CANNOT HELP, because nothing in the new assembly refers to");
    Console.WriteLine("   the old name - the reference lives in the database. This is a BINARY");
    Console.WriteLine("   COMPATIBILITY problem wearing the clothes of an ordinary rename, and a");
    Console.WriteLine("   rename is the refactor people do most freely.");
    Console.WriteLine();
    Console.WriteLine("   TREAT A JOB SIGNATURE THE WAY YOU WOULD TREAT AN API CONTRACT:");
    Console.WriteLine();
    Console.WriteLine("     ADD, DO NOT CHANGE. Keep the old method, have it call the new one,");
    Console.WriteLine("     and delete it after the queue has drained past your longest retry");
    Console.WriteLine("     window - which for a ten-attempt policy can be days.");
    Console.WriteLine();
    Console.WriteLine("     PASS IDENTIFIERS, NOT OBJECTS. A string id is a stable argument; a");
    Console.WriteLine("     serialised DTO gains a required property one day and stops");
    Console.WriteLine("     deserialising for everything already queued.");
    Console.WriteLine();
    Console.WriteLine("     KEEP JOB METHODS IN A THIN, BORING CLASS whose only job is to be");
    Console.WriteLine("     nameable. If the real logic is behind an interface, the job method is");
    Console.WriteLine("     a one-line shim you never need to rename.");
    Console.WriteLine();
    Console.WriteLine("   AND REMEMBER THE ROLLING WINDOW. During a deploy, jobs written by the");
    Console.WriteLine("   new version are executed by the old one AND the reverse. Both");
    Console.WriteLine("   directions have to work, which is the same two-version problem an API");
    Console.WriteLine("   has - and much less obvious, because nothing about a method call looks");
    Console.WriteLine("   like a contract.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the job that ran before the data existed");
    Console.WriteLine();
    Console.WriteLine("   A request creates an invoice and enqueues a job to send it. Occasionally");
    Console.WriteLine("   - a few times a day, under load - the job fails with 'invoice not");
    Console.WriteLine("   found'. The invoice is definitely there afterwards.");
    Console.WriteLine();

    Console.WriteLine("   ordering                                     job found the invoice");
    Console.WriteLine("   --------                                     ---------------------");

    foreach ((string label, bool enqueueInsideTransaction) in
        new[] { ("enqueue inside the transaction", true), ("enqueue after the commit", false) })
    {
        JobStorage.Current = new InMemoryStorage();
        Database.Reset();

        var server = new BackgroundJobServer(new BackgroundJobServerOptions
        {
            WorkerCount = 1,
            SchedulePollingInterval = TimeSpan.FromMilliseconds(50)
        });

        // The request handler.
        var transaction = new Transaction();
        transaction.Insert("INV-001");

        if (enqueueInsideTransaction)
        {
            BackgroundJob.Enqueue(() => Database.Send("INV-001"));
        }

        // The commit is slow, as commits are.
        await Task.Delay(300);
        transaction.Commit();

        if (!enqueueInsideTransaction)
        {
            BackgroundJob.Enqueue(() => Database.Send("INV-001"));
        }

        await Task.Delay(700);
        server.Dispose();

        Console.WriteLine($"   {label,-44} {(Database.Found ? "yes" : "NO - not found")}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE JOB STORE AND YOUR DATABASE ARE TWO SYSTEMS, AND THE");
    Console.WriteLine("   ENQUEUE IS NOT PART OF YOUR TRANSACTION. Enqueueing before the commit");
    Console.WriteLine("   means a worker can pick the job up and look for a row that has not been");
    Console.WriteLine("   written yet.");
    Console.WriteLine();
    Console.WriteLine("   IT IS INTERMITTENT BECAUSE IT IS A RACE. The worker has to get there");
    Console.WriteLine("   first, which under light load it rarely does and under load it");
    Console.WriteLine("   regularly does. That is the worst kind of bug to reproduce and the");
    Console.WriteLine("   easiest to introduce.");
    Console.WriteLine();
    Console.WriteLine("   ENQUEUEING AFTER THE COMMIT FIXES THE SYMPTOM AND CREATES A SECOND ONE.");
    Console.WriteLine("   If the process dies between the commit and the enqueue, the invoice");
    Console.WriteLine("   exists and no job will ever send it. You have traded 'sometimes too");
    Console.WriteLine("   early' for 'sometimes never', which is quieter and worse.");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE DUAL-WRITE PROBLEM, and it has no solution that lives in");
    Console.WriteLine("   the request handler. Two real answers:");
    Console.WriteLine();
    Console.WriteLine("     THE OUTBOX. Write the job into your OWN database, in the same");
    Console.WriteLine("     transaction as the invoice. A separate process reads the outbox table");
    Console.WriteLine("     and enqueues. One transaction, so the invoice and the intention to");
    Console.WriteLine("     send it are committed together or not at all.");
    Console.WriteLine();
    Console.WriteLine("     A JOB THAT TOLERATES BOTH ORDERS. If the job retries on 'not found'");
    Console.WriteLine("     rather than failing, an early job simply waits. That is cheaper than");
    Console.WriteLine("     an outbox and it only covers the early case, not the lost one.");
    Console.WriteLine();
    Console.WriteLine("   HANGFIRE WITH SQL SERVER STORAGE HAS A THIRD OPTION worth knowing: if");
    Console.WriteLine("   the job storage is the same database, an enqueue can join your ambient");
    Console.WriteLine("   transaction and the whole problem disappears. THE PROBLEM IS CREATED BY");
    Console.WriteLine("   THE TWO STORES BEING SEPARATE, so making them one store removes it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the queue that stopped moving");
    Console.WriteLine();
    Console.WriteLine("   A service runs two kinds of job: sending an email, which takes");
    Console.WriteLine("   milliseconds, and rebuilding a monthly report, which takes minutes.");
    Console.WriteLine("   One afternoon somebody triggers eight report rebuilds. Password reset");
    Console.WriteLine("   emails stop arriving for twenty minutes.");
    Console.WriteLine();

    Console.WriteLine("   configuration                       emails sent   slowest email waited");
    Console.WriteLine("   -------------                       -----------   --------------------");

    foreach ((string label, bool separateQueues) in
        new[] { ("one queue, four workers", false), ("two queues, dedicated workers", true) })
    {
        JobStorage.Current = new InMemoryStorage();
        Work.Reset();

        // Eight slow reports, then twenty quick emails behind them.
        for (int n = 1; n <= 8; n++)
        {
            if (separateQueues)
            {
                var client = new BackgroundJobClient();
                client.Create(() => Work.RebuildReport(n), new EnqueuedState("reports"));
            }
            else
            {
                BackgroundJob.Enqueue(() => Work.RebuildReport(n));
            }
        }

        for (int n = 1; n <= 20; n++)
        {
            if (separateQueues)
            {
                var client = new BackgroundJobClient();
                client.Create(() => Work.SendEmail(n), new EnqueuedState("emails"));
            }
            else
            {
                BackgroundJob.Enqueue(() => Work.SendEmail(n));
            }
        }

        Work.Clock.Restart();

        var server = new BackgroundJobServer(new BackgroundJobServerOptions
        {
            WorkerCount = 4,
            SchedulePollingInterval = TimeSpan.FromMilliseconds(50),

            // With one queue there is nothing to prioritise. With two, the
            // server drains 'emails' before it looks at 'reports'.
            Queues = separateQueues ? ["emails", "reports"] : ["default"]
        });

        await Task.Delay(2500);
        server.Dispose();

        Console.WriteLine($"   {label,-35} {Work.EmailsSent,11}   {Work.SlowestEmailMs,17:0} ms");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: A QUEUE IS A SHARED RESOURCE AND WORKERS ARE ITS CAPACITY. Four");
    Console.WriteLine("   workers and eight long jobs means every worker is busy for a long time,");
    Console.WriteLine("   and short jobs queued behind them wait for the whole thing.");
    Console.WriteLine();
    Console.WriteLine("   NOTHING FAILED AND NOTHING RETRIED. The emails were not lost, they were");
    Console.WriteLine("   queued - which is why the dashboard shows a healthy system with a long");
    Console.WriteLine("   queue, and why the alert that fires is 'password resets not arriving'");
    Console.WriteLine("   from a human rather than anything technical.");
    Console.WriteLine();
    Console.WriteLine("   SEPARATE QUEUES SEPARATE THE CAPACITY. The Queues list is also a");
    Console.WriteLine("   PRIORITY ORDER: a server given ['emails', 'reports'] empties emails");
    Console.WriteLine("   before it looks at reports, so a burst of slow work cannot starve the");
    Console.WriteLine("   fast work.");
    Console.WriteLine();
    Console.WriteLine("   THE PRINCIPLE IS OLDER THAN JOB SCHEDULERS: DO NOT PUT WORK WITH");
    Console.WriteLine("   DIFFERENT LATENCY REQUIREMENTS IN THE SAME QUEUE. It is the same reason");
    Console.WriteLine("   a supermarket has a basket-only till, and the same reason a thread pool");
    Console.WriteLine("   shared between fast requests and slow ones serves neither well.");
    Console.WriteLine();
    Console.WriteLine("   TWO REFINEMENTS WORTH KNOWING:");
    Console.WriteLine();
    Console.WriteLine("     SEPARATE PROCESSES ARE STRONGER THAN SEPARATE QUEUES. Queues divide");
    Console.WriteLine("     the workers; a separate deployment divides the memory, the CPU and");
    Console.WriteLine("     the failure domain too. If the report job can exhaust memory, it");
    Console.WriteLine("     should not share a process with anything you care about.");
    Console.WriteLine();
    Console.WriteLine("     A LONG JOB IS OFTEN SEVERAL SHORT ONES. A report rebuild that fans");
    Console.WriteLine("     out per section is interruptible, resumable, parallel, and stops");
    Console.WriteLine("     occupying a worker for minutes at a time - which is the same fan-out");
    Console.WriteLine("     that fixed the invoicing incident, for a different reason.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
public static class OldVersion
{
    public static void SendInvoice(string accountId)
    {
    }
}

// ---------------------------------------------------------------------------
public static class NewVersion
{
    public static void SendInvoiceAsync(string accountId, string correlationId)
    {
    }
}

// ---------------------------------------------------------------------------
// Stands in for the application database and a transaction over it.
public static class Database
{
    static readonly HashSet<string> Committed = [];

    public static bool Found;

    public static void Reset()
    {
        lock (Committed)
        {
            Committed.Clear();
        }

        Found = false;
    }

    public static void Commit(string invoiceId)
    {
        lock (Committed)
        {
            Committed.Add(invoiceId);
        }
    }

    public static void Send(string invoiceId)
    {
        lock (Committed)
        {
            Found = Committed.Contains(invoiceId);
        }
    }
}

// ---------------------------------------------------------------------------
public sealed class Transaction
{
    string? pending;

    public void Insert(string invoiceId) => pending = invoiceId;

    public void Commit()
    {
        if (pending is not null)
        {
            Database.Commit(pending);
        }
    }
}

// ---------------------------------------------------------------------------
public static class Work
{
    public static readonly System.Diagnostics.Stopwatch Clock = new();

    public static int EmailsSent;

    public static double SlowestEmailMs;

    public static void Reset()
    {
        EmailsSent = 0;
        SlowestEmailMs = 0;
    }

    public static void RebuildReport(int month) => Thread.Sleep(400);

    public static void SendEmail(int id)
    {
        Interlocked.Increment(ref EmailsSent);

        double waited = Clock.Elapsed.TotalMilliseconds;

        lock (Clock)
        {
            if (waited > SlowestEmailMs)
            {
                SlowestEmailMs = waited;
            }
        }
    }
}
