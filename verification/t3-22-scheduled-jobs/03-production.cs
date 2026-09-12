// 03-production.cs — The deploy that sent eight thousand invoices twice.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Hangfire.Core@1.8.21
#:package Hangfire.InMemory@1.0.0
#:package Newtonsoft.Json@13.0.4

using Hangfire;
using Hangfire.InMemory;

Console.WriteLine("An incident: 'why has everyone been invoiced twice?'");
Console.WriteLine();

TheIncident();
await WhatARequeueDoes();
await WhyRetriesMadeItWorse();
await TheFix();
WhatToWatch();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. What was seen");
    Console.WriteLine();
    Console.WriteLine("   Ledger invoices its customers on the first of the month. One recurring");
    Console.WriteLine("   job, running at 02:00, walking eight thousand accounts and sending an");
    Console.WriteLine("   invoice for each. It had run for eleven months.");
    Console.WriteLine();
    Console.WriteLine("     02:00   The job starts.");
    Console.WriteLine();
    Console.WriteLine("     02:04   A routine deployment begins. The orchestrator stops the old");
    Console.WriteLine("             pods. The job is roughly a third of the way through.");
    Console.WriteLine();
    Console.WriteLine("     02:06   The new pods are up. Hangfire notices the server that had");
    Console.WriteLine("             claimed the job is gone, and puts the job back on the queue.");
    Console.WriteLine("             A new worker picks it up and starts it AT THE BEGINNING.");
    Console.WriteLine();
    Console.WriteLine("     02:14   The job completes successfully. The dashboard shows one");
    Console.WriteLine("             succeeded job. Everything looks normal.");
    Console.WriteLine();
    Console.WriteLine("     08:30   Support has 2,600 emails about duplicate invoices.");
    Console.WriteLine();
    Console.WriteLine("   THE JOB SUCCEEDED. That is what makes this one hard to see: there is no");
    Console.WriteLine("   failed job, no exception, no retry visible in the dashboard, and the");
    Console.WriteLine("   final state of the run is Succeeded. The only evidence is in the");
    Console.WriteLine("   invoices themselves.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatARequeueDoes()
{
    Console.WriteLine("2. What happens to a job whose server disappears");
    Console.WriteLine();
    Console.WriteLine("   Twenty accounts rather than eight thousand, and a deployment that");
    Console.WriteLine("   lands after a third of them.");
    Console.WriteLine();

    JobStorage.Current = new InMemoryStorage();
    Invoicing.Reset();

    string jobId = BackgroundJob.Enqueue(() => Invoicing.SendMonthlyInvoices(null!));

    // The server that starts the job and is then stopped mid-run, which is
    // what a deployment does to a pod. The job observes its cancellation
    // token, so stopping the server really does interrupt it - a job that
    // ignores the token would simply hold the deployment up instead.
    var before = new BackgroundJobServer(new BackgroundJobServerOptions
    {
        WorkerCount = 1,
        SchedulePollingInterval = TimeSpan.FromMilliseconds(50),
        ShutdownTimeout = TimeSpan.FromMilliseconds(100)
    });

    await Task.Delay(400);

    before.Dispose();

    int sentBeforeDeploy = Invoicing.Sent.Count;

    // The scheduler's orphan detection does this automatically once the dead
    // server's heartbeat expires - a matter of minutes with the default
    // settings, which is longer than this file can wait. Requeueing by hand
    // is the same transition, triggered immediately.
    BackgroundJob.Requeue(jobId);

    var after = new BackgroundJobServer(new BackgroundJobServerOptions
    {
        WorkerCount = 1,
        SchedulePollingInterval = TimeSpan.FromMilliseconds(50)
    });

    await Task.Delay(1600);
    after.Dispose();

    int total = Invoicing.Sent.Count;
    int distinct = Invoicing.Sent.Distinct().Count();

    Console.WriteLine("   accounts to invoice                    20");
    Console.WriteLine($"   invoices sent before the deploy        {sentBeforeDeploy}");
    Console.WriteLine($"   invoices sent in total                 {total}");
    Console.WriteLine($"   distinct accounts invoiced             {distinct}");
    Console.WriteLine($"   accounts invoiced MORE THAN ONCE       {Invoicing.Sent.GroupBy(a => a).Count(g => g.Count() > 1)}");

    Console.WriteLine();
    Console.WriteLine("   THE JOB RESTARTED FROM THE BEGINNING and re-sent everything the first");
    Console.WriteLine("   run had already done.");
    Console.WriteLine();
    Console.WriteLine("   NOTHING HERE IS A BUG. Every component did what it promises:");
    Console.WriteLine();
    Console.WriteLine("     THE ORCHESTRATOR stopped a pod, which is what a deployment is.");
    Console.WriteLine();
    Console.WriteLine("     THE SCHEDULER put the job back, because the server holding it had");
    Console.WriteLine("     stopped reporting. That is the behaviour that makes a job store worth");
    Console.WriteLine("     having - without it, work claimed by a machine that died would be");
    Console.WriteLine("     lost forever. A job in Processing is a CLAIM, not a lock, and a claim");
    Console.WriteLine("     by a server that no longer exists has to be released by somebody.");
    Console.WriteLine();
    Console.WriteLine("     THE JOB ran to completion and reported success. It had no way to");
    Console.WriteLine("     know it was a second attempt, because nothing told it.");
    Console.WriteLine();
    Console.WriteLine("   THE GUARANTEE YOU HAVE IS AT-LEAST-ONCE, AND IT IS NOT A WEAKNESS - it");
    Console.WriteLine("   is the strongest guarantee available without a transaction spanning");
    Console.WriteLine("   your database and the invoice provider, and there is no such thing.");
    Console.WriteLine();
    Console.WriteLine("   SO THE JOB HAS TO BE SAFE TO RUN TWICE. That is not a mitigation for a");
    Console.WriteLine("   rare case - it is the contract, and every job in every scheduler is");
    Console.WriteLine("   written under it whether or not its author knew.");
    Console.WriteLine();
    Console.WriteLine("   ONE DETAIL ABOUT THE MEASUREMENT, because it matters in practice: the");
    Console.WriteLine("   job above observes its cancellation token, so stopping the server");
    Console.WriteLine("   interrupted it. A JOB THAT IGNORES THE TOKEN CANNOT BE INTERRUPTED, so");
    Console.WriteLine("   instead of being requeued it holds the deployment open until the");
    Console.WriteLine("   server's shutdown timeout expires - and is then killed anyway, in the");
    Console.WriteLine("   same state. Observing the token changes how long the deploy takes, not");
    Console.WriteLine("   whether the job runs twice.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhyRetriesMadeItWorse()
{
    Console.WriteLine("3. And the retry policy nobody set");
    Console.WriteLine();
    Console.WriteLine("   The same job, this time failing two thirds of the way through - one bad");
    Console.WriteLine("   account, a missing billing address, the sort of thing that happens once.");
    Console.WriteLine();
    Console.WriteLine("   (The retry delays are set to zero here so the file finishes. The real");
    Console.WriteLine("   defaults grow from seconds to hours across ten attempts.)");
    Console.WriteLine();

    JobStorage.Current = new InMemoryStorage();
    Invoicing.Reset();
    Invoicing.FailAt = 14;

    BackgroundJob.Enqueue(() => Invoicing.SendMonthlyInvoicesWithRetries(null!));

    var server = new BackgroundJobServer(new BackgroundJobServerOptions
    {
        WorkerCount = 1,
        SchedulePollingInterval = TimeSpan.FromMilliseconds(50)
    });

    await Task.Delay(4000);
    server.Dispose();

    Console.WriteLine($"   attempts made                          {Invoicing.Attempts}");
    Console.WriteLine($"   invoices sent in total                 {Invoicing.Sent.Count}");
    Console.WriteLine($"   distinct accounts invoiced             {Invoicing.Sent.Distinct().Count()}");
    Console.WriteLine($"   most times any one account was sent    " +
        $"{(Invoicing.Sent.Count == 0 ? 0 : Invoicing.Sent.GroupBy(a => a).Max(g => g.Count()))}");

    Console.WriteLine();
    Console.WriteLine("   EACH RETRY RE-SENT THE THIRTEEN INVOICES THAT HAD ALREADY SUCCEEDED,");
    Console.WriteLine("   then hit the same bad account and failed again.");
    Console.WriteLine();
    Console.WriteLine("   THE DEFAULT IS TEN ATTEMPTS, and nobody chose it. A job that is not");
    Console.WriteLine("   idempotent and not resumable turns one bad record into ten copies of");
    Console.WriteLine("   everything before it - and the further into the run the failure is,");
    Console.WriteLine("   the worse the amplification.");
    Console.WriteLine();
    Console.WriteLine("   WHICH IS THE PART WORTH INTERNALISING: RETRY IS ONLY SAFE FOR WORK THAT");
    Console.WriteLine("   IS SAFE TO REPEAT. Turning retries on for a job that is not idempotent");
    Console.WriteLine("   does not improve reliability, it multiplies the damage - and it is on");
    Console.WriteLine("   by default, so it is multiplying the damage in jobs nobody has");
    Console.WriteLine("   thought about.");
    Console.WriteLine();
    Console.WriteLine("   NOTE ALSO THAT THE RETRIES WERE USELESS HERE. A missing billing address");
    Console.WriteLine("   will still be missing on the tenth attempt. Retrying helps with");
    Console.WriteLine("   TRANSIENT failures - a timeout, a deadlock, a rate limit - and does");
    Console.WriteLine("   nothing about a bad record except repeat the side effects around it.");
    Console.WriteLine();
    Console.WriteLine("   THE OTHER HALF OF THE SHAPE IS THE ONE-BIG-JOB DESIGN. Eight thousand");
    Console.WriteLine("   accounts in a single job means a single failure anywhere loses the");
    Console.WriteLine("   whole run, and a single retry repeats the whole run. THE UNIT OF WORK");
    Console.WriteLine("   AND THE UNIT OF RETRY ARE THE SAME THING, and here that unit is far too");
    Console.WriteLine("   big.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheFix()
{
    Console.WriteLine("4. Three changes, and which one does the work");
    Console.WriteLine();

    JobStorage.Current = new InMemoryStorage();
    Invoicing.Reset();
    Invoicing.FailAt = 14;

    // CHANGE ONE: the run enqueues one job per account rather than doing all
    // the work itself. The unit of work becomes one account.
    string fanOutId = BackgroundJob.Enqueue(() => Invoicing.FanOutMonthlyInvoices());

    var server = new BackgroundJobServer(new BackgroundJobServerOptions
    {
        WorkerCount = 4,
        SchedulePollingInterval = TimeSpan.FromMilliseconds(50)
    });

    await Task.Delay(2500);

    int afterFirstRun = Invoicing.Sent.Count;

    // The same interruption as section 2: the whole run is requeued and does
    // all of it again. This is the case the guard exists for.
    BackgroundJob.Requeue(fanOutId);

    await Task.Delay(2500);
    server.Dispose();

    Console.WriteLine($"   accounts to invoice                    20");
    Console.WriteLine($"   invoiced on the first run              {afterFirstRun}");
    Console.WriteLine($"   invoiced after the whole run repeated  {Invoicing.Sent.Count}");
    Console.WriteLine($"   distinct accounts invoiced             {Invoicing.Sent.Distinct().Count()}");
    Console.WriteLine($"   accounts invoiced MORE THAN ONCE       {Invoicing.Sent.GroupBy(a => a).Count(g => g.Count() > 1)}");
    Console.WriteLine($"   duplicate sends the guard refused      {Invoicing.Suppressed}");
    Console.WriteLine($"   attempts on the one bad account        {Invoicing.BadAccountAttempts}");

    Console.WriteLine();
    Console.WriteLine("   CHANGE ONE: FAN OUT. The scheduled job's only job is to enqueue one job");
    Console.WriteLine("   per account. That makes the unit of work one account, so a failure");
    Console.WriteLine("   costs one account, a retry repeats one account, and a deployment");
    Console.WriteLine("   mid-run abandons at most one account per worker.");
    Console.WriteLine();
    Console.WriteLine("   IT ALSO MAKES THE WORK PARALLEL for free, which is a genuine bonus and");
    Console.WriteLine("   is not the reason to do it. The reason is that the unit of work and the");
    Console.WriteLine("   unit of retry are the same thing, so you get to choose how much a");
    Console.WriteLine("   failure costs by choosing how big a job is.");
    Console.WriteLine();
    Console.WriteLine("   CHANGE TWO: AN IDEMPOTENCY GUARD IN THE JOB. Before sending, check");
    Console.WriteLine("   whether this account already has an invoice for this period, and stop");
    Console.WriteLine("   if it does. THE WHOLE RUN WAS REPEATED, EXACTLY AS IN SECTION 2, and");
    Console.WriteLine("   not one account was invoiced twice - every repeat hit the guard.");
    Console.WriteLine();
    Console.WriteLine("   THE GUARD MUST BE IN THE SAME TRANSACTION AS THE WORK, OR IT IS A RACE.");
    Console.WriteLine("   'Check then send' with a gap between them is two workers both checking,");
    Console.WriteLine("   both finding nothing, and both sending. A unique constraint on");
    Console.WriteLine("   (account, period) is the version that actually holds, because the");
    Console.WriteLine("   database decides rather than your code.");
    Console.WriteLine();
    Console.WriteLine("   CHANGE THREE: A RETRY POLICY THAT WAS CHOSEN. Ten attempts is right for");
    Console.WriteLine("   a transient network failure and wrong for a malformed record, which");
    Console.WriteLine("   will fail identically ten times and then sit in Failed. Set it per job:");
    Console.WriteLine();
    Console.WriteLine("     [AutomaticRetry(Attempts = 3, OnAttemptsExceeded = AttemptsExceededAction.Fail)]");
    Console.WriteLine("     public static void SendInvoice(string accountId) { }");
    Console.WriteLine();
    Console.WriteLine("   AND NOTICE WHICH CHANGE IS LOAD-BEARING. Fanning out reduces the blast");
    Console.WriteLine("   radius and the guard is what makes the job correct. WITHOUT THE GUARD,");
    Console.WriteLine("   FANNING OUT WOULD HAVE TURNED ONE DUPLICATE RUN INTO TWENTY SMALLER");
    Console.WriteLine("   DUPLICATE RUNS - a tidier version of the same incident.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToWatch()
{
    Console.WriteLine("5. What to watch");
    Console.WriteLine();
    Console.WriteLine("   THE FAILED JOB COUNT, EXPORTED AND ALERTED ON. Failed is a resting");
    Console.WriteLine("   place, not an error channel: jobs sit there indefinitely and nothing");
    Console.WriteLine("   pages anybody. Every team discovers this eventually, usually by finding");
    Console.WriteLine("   a dashboard with four hundred failures on it going back months.");
    Console.WriteLine();
    Console.WriteLine("   THE AGE OF THE OLDEST ENQUEUED JOB. Queue depth is ambiguous - a big");
    Console.WriteLine("   queue may be a busy morning. A job that has been waiting an hour is");
    Console.WriteLine("   not ambiguous.");
    Console.WriteLine();
    Console.WriteLine("   RETRY COUNTS AS A RATE, NOT A TOTAL. A steady trickle of first retries");
    Console.WriteLine("   is a healthy system absorbing transient failures. A rise in SECOND and");
    Console.WriteLine("   THIRD attempts means the retries are not working, and that is a");
    Console.WriteLine("   different problem with a different fix.");
    Console.WriteLine();
    Console.WriteLine("   JOBS REQUEUED AFTER A SERVER VANISHED. This is the incident's signal");
    Console.WriteLine("   and it is available: the scheduler knows it requeued the job, and it");
    Console.WriteLine("   correlates exactly with your deployments. IF THAT NUMBER IS NOT ZERO");
    Console.WriteLine("   AFTER EVERY DEPLOY, YOU HAVE JOBS BEING RUN TWICE - and whether that");
    Console.WriteLine("   matters depends entirely on whether they are idempotent.");
    Console.WriteLine();
    Console.WriteLine("   AND A REVIEW QUESTION FOR EVERY JOB: WHAT HAPPENS IF THIS RUNS TWICE?");
    Console.WriteLine("   If the answer is anything other than 'nothing', the job is not");
    Console.WriteLine("   finished. It is not a rare case, it is the delivery guarantee, and it");
    Console.WriteLine("   will happen on the next deployment that lands mid-run.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// The invoicing work, in both shapes: one big job, and one job per account.
public static class Invoicing
{
    public static readonly List<string> Sent = [];

    // Stands in for the invoices table, and for the unique constraint on it.
    static readonly HashSet<string> Recorded = [];

    public static int Attempts;

    public static int BadAccountAttempts;

    public static int Suppressed;

    public static int FailAt = int.MaxValue;

    public static void Reset()
    {
        lock (Sent)
        {
            Sent.Clear();
            Recorded.Clear();
        }

        Attempts = 0;
        BadAccountAttempts = 0;
        Suppressed = 0;
        FailAt = int.MaxValue;
    }

    // The job as written: one job, every account, no guard. It observes its
    // cancellation token, so a deployment interrupts it rather than waiting.
    public static void SendMonthlyInvoices(IJobCancellationToken cancellation)
    {
        Interlocked.Increment(ref Attempts);

        for (int n = 1; n <= 20; n++)
        {
            cancellation?.ThrowIfCancellationRequested();

            if (n == FailAt)
            {
                throw new InvalidOperationException($"Account ACC-{n:000} has no billing address.");
            }

            Thread.Sleep(25);

            lock (Sent)
            {
                Sent.Add($"ACC-{n:000}");
            }
        }
    }

    // The same job, with the retry delays shortened so that ten attempts fit
    // inside a file that has to finish. The COUNT is the default.
    [AutomaticRetry(Attempts = 10, DelaysInSeconds = [0])]
    public static void SendMonthlyInvoicesWithRetries(IJobCancellationToken cancellation) =>
        SendMonthlyInvoices(cancellation);

    // CHANGE ONE: the scheduled job only fans out.
    public static void FanOutMonthlyInvoices()
    {
        for (int n = 1; n <= 20; n++)
        {
            string account = $"ACC-{n:000}";

            BackgroundJob.Enqueue(() => SendInvoice(account, "2027-06"));
        }
    }

    // CHANGE TWO: the guard. In a real system the HashSet is a unique
    // constraint on (account, period) and the check is the insert.
    // CHANGE THREE: a retry policy that was chosen. Three attempts, and the
    // delays are zeroed so this file finishes - the COUNT is the point.
    [AutomaticRetry(Attempts = 3, DelaysInSeconds = [0], OnAttemptsExceeded = AttemptsExceededAction.Fail)]
    public static void SendInvoice(string accountId, string period)
    {
        if (accountId == $"ACC-{FailAt:000}")
        {
            Interlocked.Increment(ref BadAccountAttempts);

            throw new InvalidOperationException($"Account {accountId} has no billing address.");
        }

        lock (Sent)
        {
            if (!Recorded.Add($"{accountId}:{period}"))
            {
                Interlocked.Increment(ref Suppressed);

                return;
            }
        }

        Thread.Sleep(25);

        lock (Sent)
        {
            Sent.Add(accountId);
        }
    }
}
