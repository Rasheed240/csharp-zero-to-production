// 05-minimal-example.cs — One job system with every decision made: fan-out, an
// idempotency guard, a chosen retry policy, separate queues, an explicit time
// zone, and the numbers you would alert on.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic. The retry delays and cron
// intervals are shortened so the file finishes; the shapes are the point.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Hangfire.Core@1.8.21
#:package Hangfire.InMemory@1.0.0
#:package Newtonsoft.Json@13.0.4

using Hangfire;
using Hangfire.InMemory;
using Hangfire.States;
using Hangfire.Storage;
using Hangfire.Storage.Monitoring;

JobStorage.Current = new InMemoryStorage();

// DECISION 1: fast work and slow work do not share a queue, and the order of
// this list is a priority order.
var server = new BackgroundJobServer(new BackgroundJobServerOptions
{
    WorkerCount = 4,
    SchedulePollingInterval = TimeSpan.FromMilliseconds(50),
    Queues = ["notifications", "invoices", "reports", "default"]
});

var client = new BackgroundJobClient();

Console.WriteLine("One job system, every decision made");
Console.WriteLine();

// DECISION 2: the recurring job fans out. Its own work is trivial and fast,
// so an interrupted run costs nothing and a repeated run enqueues jobs that
// are individually idempotent.
Billing.Reset();

// Two accounts will fail: one transiently, one permanently. Set before
// anything is enqueued, so no job can race the configuration.
Billing.FailTransientlyUntilAttempt = 3;
Billing.PermanentlyBrokenAccount = "ACC-017";

string runId = client.Create(() => Billing.FanOutMonthlyInvoices("2027-06"),
    new EnqueuedState("invoices"));

await Task.Delay(4000);

// The same interruption as the incident: the whole run repeated.
BackgroundJob.Requeue(runId);

await Task.Delay(4000);

Console.WriteLine("   AFTER THE RUN, AND A FULL REPEAT OF IT");
Console.WriteLine();
Console.WriteLine($"     accounts                              20");
Console.WriteLine($"     invoices sent                         {Billing.Sent.Count}");
Console.WriteLine($"     accounts invoiced more than once      {Billing.Sent.GroupBy(a => a).Count(g => g.Count() > 1)}");
Console.WriteLine($"     duplicate sends the guard refused     {Billing.Suppressed}");
Console.WriteLine($"     attempts on the transiently failing   {Billing.TransientAttempts}");
Console.WriteLine($"     attempts on the permanently broken    {Billing.PermanentAttempts}");
Console.WriteLine();

// The numbers worth alerting on, all available from the monitoring API.
IMonitoringApi monitoring = JobStorage.Current.GetMonitoringApi();
StatisticsDto statistics = monitoring.GetStatistics();

Console.WriteLine("   WHAT THE MONITORING API WILL TELL YOU");
Console.WriteLine();
Console.WriteLine($"     enqueued    {statistics.Enqueued}");
Console.WriteLine($"     processing  {statistics.Processing}");
Console.WriteLine($"     scheduled   {statistics.Scheduled}");
Console.WriteLine($"     succeeded   {statistics.Succeeded}");
Console.WriteLine($"     FAILED      {statistics.Failed}");
Console.WriteLine();

server.Dispose();

Console.WriteLine("   EVERY DECISION, AND WHY:");
Console.WriteLine();
Console.WriteLine("     THE RECURRING JOB ONLY FANS OUT. Its own body is a loop that enqueues,");
Console.WriteLine("     so it finishes in milliseconds. An interrupted fan-out costs nothing");
Console.WriteLine("     and a repeated one enqueues duplicates that the guard then refuses -");
Console.WriteLine("     which is exactly what the numbers above show.");
Console.WriteLine();
Console.WriteLine("     THE UNIT OF WORK IS ONE ACCOUNT. A failure costs one account, a retry");
Console.WriteLine("     repeats one account, and a deployment mid-run abandons at most one per");
Console.WriteLine("     worker. The unit of work and the unit of retry are the same thing, so");
Console.WriteLine("     choosing how big a job is chooses how much a failure costs.");
Console.WriteLine();
Console.WriteLine("     EVERY JOB IS IDEMPOTENT, AND THE GUARD IS THE WRITE. The check is not");
Console.WriteLine("     'select then insert' with a gap in the middle - it is an insert that");
Console.WriteLine("     fails when the row exists. Two workers racing both call it and exactly");
Console.WriteLine("     one wins, because the database decides rather than the code.");
Console.WriteLine();
Console.WriteLine("     THE RETRY POLICY WAS CHOSEN, PER JOB. Three attempts for the send,");
Console.WriteLine("     because a gateway timeout is worth retrying. Look at the two failure");
Console.WriteLine("     rows: the transient one succeeded on its third attempt, and the");
Console.WriteLine("     permanently broken one used four attempts per run and then stopped,");
Console.WriteLine("     landing in Failed twice. RETRIES HELP WITH");
Console.WriteLine("     TRANSIENT FAILURES AND DO NOTHING FOR BAD DATA except delay the moment");
Console.WriteLine("     somebody looks at it.");
Console.WriteLine();
Console.WriteLine("     FOUR QUEUES, IN PRIORITY ORDER. Notifications are fast and urgent,");
Console.WriteLine("     invoices are the bulk, reports are slow. A burst of reports cannot");
Console.WriteLine("     starve a password reset, because the server drains the list in order.");
Console.WriteLine();
Console.WriteLine("     AND default IS IN THAT LIST DELIBERATELY. A retry is re-enqueued on");
Console.WriteLine("     the default queue, not the one the job started on. Leave default out");
Console.WriteLine("     and every retry in the system lands in a queue nothing is watching -");
Console.WriteLine("     which looks exactly like jobs silently vanishing, and was two hours of");
Console.WriteLine("     confusion while this file was being written.");
Console.WriteLine();
Console.WriteLine("     THE SCHEDULE CARRIES ITS TIME ZONE. '0 2 1 * *' with an explicit");
Console.WriteLine("     Europe/London means the first of the month at two in the morning as the");
Console.WriteLine("     business understands it, in both halves of the year.");
Console.WriteLine();
Console.WriteLine("     AND Failed IS EXPORTED. It is a resting place, not an error channel -");
Console.WriteLine("     jobs sit there indefinitely and nothing pages anybody. The count above");
Console.WriteLine("     is one line to read and the only thing that turns a broken account into");
Console.WriteLine("     an alert rather than a discovery.");
Console.WriteLine();
Console.WriteLine("   WHAT THIS STILL DOES NOT SOLVE:");
Console.WriteLine();
Console.WriteLine("     THE ENQUEUE IS NOT IN YOUR TRANSACTION unless the job storage is your");
Console.WriteLine("     database. Enqueueing from a request handler that has not committed yet");
Console.WriteLine("     is a race; enqueueing after the commit can lose the job entirely. An");
Console.WriteLine("     outbox table is the answer, and it is a design decision above this");
Console.WriteLine("     file.");
Console.WriteLine();
Console.WriteLine("     AND IN-MEMORY STORAGE GIVES YOU NONE OF THE DURABILITY THIS MODULE IS");
Console.WriteLine("     ABOUT. It is used here so the file runs anywhere with no database. The");
Console.WriteLine("     moment the process ends the jobs go with it - which is precisely the");
Console.WriteLine("     property a real storage exists to remove.");

// ---------------------------------------------------------------------------
public static class Billing
{
    public static readonly List<string> Sent = [];

    // Stands in for a unique constraint on (account, period).
    static readonly HashSet<string> Invoiced = [];

    public static int Suppressed;

    public static int TransientAttempts;

    public static int PermanentAttempts;

    public static int FailTransientlyUntilAttempt;

    public static string PermanentlyBrokenAccount = "";

    public static void Reset()
    {
        lock (Sent)
        {
            Sent.Clear();
            Invoiced.Clear();
        }

        Suppressed = 0;
        TransientAttempts = 0;
        PermanentAttempts = 0;
    }

    // Fast, trivial, and safe to repeat: it only enqueues.
    public static void FanOutMonthlyInvoices(string period)
    {
        var client = new BackgroundJobClient();

        for (int n = 1; n <= 20; n++)
        {
            string account = $"ACC-{n:000}";

            client.Create(() => SendInvoice(account, period), new EnqueuedState("invoices"));
        }
    }

    // Three attempts, because a gateway timeout is worth retrying and a bad
    // record is not. The delays are zeroed so this file finishes; the count is
    // the decision.
    [AutomaticRetry(Attempts = 3, DelaysInSeconds = [0], OnAttemptsExceeded = AttemptsExceededAction.Fail)]
    public static void SendInvoice(string accountId, string period)
    {
        // The permanently broken account: retrying will never help.
        if (accountId == PermanentlyBrokenAccount)
        {
            Interlocked.Increment(ref PermanentAttempts);

            throw new InvalidOperationException($"{accountId} has no billing address.");
        }

        // The transiently broken one: the third attempt succeeds.
        if (accountId == "ACC-009")
        {
            int attempt = Interlocked.Increment(ref TransientAttempts);

            if (attempt < FailTransientlyUntilAttempt)
            {
                throw new TimeoutException("The gateway did not respond.");
            }
        }

        // THE GUARD, and it is the write. Add returns false when the row is
        // already there, which is what a unique constraint does for you.
        lock (Sent)
        {
            if (!Invoiced.Add($"{accountId}:{period}"))
            {
                Interlocked.Increment(ref Suppressed);

                return;
            }
        }

        Thread.Sleep(15);

        lock (Sent)
        {
            Sent.Add(accountId);
        }
    }
}
