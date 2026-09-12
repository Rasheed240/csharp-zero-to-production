CSPREP.module({
  id: "t3-22-scheduled-jobs",
  minutes: 55,
  updated: "2026-09-07",
  summary: "A deployment landed four minutes into the monthly invoicing run, the scheduler correctly requeued the abandoned job, and eight thousand customers were invoiced twice - with the dashboard showing one succeeded job and no errors anywhere. Measured: work that survives a restart against work that does not; a retry policy nobody set turning one bad record into ten copies of everything before it; a daily job that fires at 02:00 instead of 01:30 on one day a year; and the fan-out plus idempotency guard that made a full repeat of the run cost nothing.",
  terms: ["job storage", "job state machine", "at-least-once delivery", "idempotency",
    "idempotency guard", "fan-out", "retry policy", "cron expression", "recurring job",
    "misfire", "requeue", "orphaned job", "queue priority", "dual write", "outbox"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>The previous module ended on a limitation: a loop in a <code>BackgroundService</code> is not a
  schedule, its work exists only as items in a collection owned by one process, and a replica count of
  three means three copies of it. This module is about what you get when the work is written down
  instead.</p>

  <p>Ledger invoices its customers on the first of the month — one recurring job at 02:00, walking eight
  thousand accounts. It had run for eleven months. On the twelfth, a routine deployment began at 02:04,
  four minutes into the run.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   accounts to invoice                    20
   invoices sent before the deploy        13
   invoices sent in total                 34
   distinct accounts invoiced             20
   accounts invoiced MORE THAN ONCE       14</code></pre>

  <p>The dashboard showed one job, in the <code>Succeeded</code> state. No exception, no failed job, no
  retry recorded. Support found out at 08:30, from 2,600 emails.</p>

  <div class="callout callout--note">
    <h4>Nothing in that sequence is a bug</h4>
    <p>The orchestrator stopped a pod, which is what a deployment is. The scheduler noticed the server
    holding the job had stopped reporting and put the job back — which is the behaviour that makes a job
    store worth having, because without it work claimed by a machine that died would be lost forever.
    And the job ran to completion and reported success, because nothing told it this was the second
    attempt.</p>
  </div>

  <p>The guarantee you have is <em>at-least-once</em>, and every job in every scheduler is written under
  it whether or not its author knew.</p>
</section>

<section id="what-a-job-is">
  <h2>What a job is, once it is written down</h2>

  <p class="define"><span class="define__term">Job storage</span> A database the scheduler uses to
  record work: what to run, with which arguments, in what state, and which server has claimed it.
  Hangfire calls it storage; Quartz calls it a job store.</p>

  <p class="define"><span class="define__term">Job</span> A row describing a method call — a type name,
  a method name, and the arguments serialised as JSON — plus a state.</p>

  <p class="define"><span class="define__term">Worker</span> A thread that takes a job out of storage,
  marks it as claimed, runs it, and records the outcome.</p>

  <p class="define"><span class="define__term">Recurring job</span> A named schedule, stored alongside
  the jobs, that enqueues a new job whenever its cron expression comes due.</p>

  <p class="define"><span class="define__term">Queue</span> A named list within the storage. A server is
  configured with the queues it will take work from, in priority order.</p>

  <p class="define"><span class="define__term">Server</span> One process running workers. Several
  servers share one storage, which is how the work distributes without anybody coordinating it.</p>

  <p class="define"><span class="define__term">At-least-once delivery</span> The guarantee that a job
  runs one or more times, never zero. The alternative — at-most-once — would mean losing work whenever a
  machine died mid-job.</p>

  <p class="define"><span class="define__term">Idempotent</span> Safe to perform more than once with the
  same result as performing it once. Under at-least-once delivery this is a requirement, not a
  refinement.</p>

  <p class="define"><span class="define__term">Retry policy</span> How many further attempts a failed
  job gets and how long between them. Ten attempts is the default in Hangfire, with delays growing from
  seconds to hours.</p>

  <pre data-lang="csharp" data-net="10" data-title="The whole setup"><code>GlobalConfiguration.Configuration.UseInMemoryStorage();

using var server = new BackgroundJobServer();

// Run as soon as a worker is free.
BackgroundJob.Enqueue(() =&gt; Invoicing.SendInvoice("ACC-001"));

// Run later. The delay is a timestamp in storage, not a Task.Delay.
BackgroundJob.Schedule(() =&gt; Invoicing.SendInvoice("ACC-002"), TimeSpan.FromHours(1));

// Run on a schedule, forever.
RecurringJob.AddOrUpdate("monthly-invoices",
    () =&gt; Invoicing.SendMonthlyInvoices(), "0 2 1 * *");</code></pre>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   three jobs created, before any of them has run:

   job        id                         state
   ---------- -------------------------- -----
   enqueued   1                          Enqueued
   scheduled  2                          Scheduled
   failing    3                          Enqueued

   after a second and a half:

   enqueued   1                          Succeeded
   scheduled  2                          Succeeded
   failing    3                          Scheduled

   invoices actually sent   INV-001, INV-002
   attempts on INV-003      1</code></pre>

  <p>Four things happened that nobody wrote. The work was written down <em>before</em> it ran. The
  failure was retried, ten times by default. The delay survived outside any process. And the arguments
  were serialised — which is the one that bites.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>A job queue is a ticket spike in a kitchen. An order is written on a docket and put on the spike;
  whichever chef is free takes the next one; a docket that is dropped is still on the floor to be picked
  up. The work exists independently of whoever is doing it.</p>

  <p>Where it stops is that a chef can see a half-cooked dish and carry on from there. <strong>A
  requeued job has no idea it is a second attempt.</strong> The docket goes back on the spike exactly as
  it was written, and the next chef starts from the beginning — which is the entire incident above.</p>
</section>

<section id="what-storage-buys">
  <h2>What the storage actually buys</h2>

  <p>Twelve pieces of work, queued two ways, with the process stopping after roughly a third:</p>

  <pre data-lang="console" data-title="01-storage-and-restart.cs output"><code>   queue                  done before stop   still queued   done after restart   LOST
   -----                  ----------------   ------------   ------------------   ----
   ConcurrentQueue                       5              7                    0      7
   Hangfire storage                      2             10                   10      0</code></pre>

  <p>Nothing was transferred and nothing was handed over: the second server queried the same storage and
  found rows that had never been marked as done. <strong>The work outlives the process that was asked to
  do it</strong>, and everything else in this module — retries, scheduling, distribution — is a
  consequence of the work being a durable record rather than a call stack.</p>

  <h3>The states a job moves through</h3>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>State</th><th>Means</th></tr>
      </thead>
      <tbody>
        <tr><td><code>Enqueued</code></td><td>Waiting for a free worker</td></tr>
        <tr><td><code>Scheduled</code></td><td>Waiting for a time — a delay, or a retry</td></tr>
        <tr><td><code>Processing</code></td><td>A named server and worker has claimed it</td></tr>
        <tr><td><code>Succeeded</code></td><td>Finished; kept for a while so you can see it happened</td></tr>
        <tr><td><code>Failed</code></td><td>Out of retries; kept until somebody looks</td></tr>
        <tr><td><code>Deleted</code></td><td>Removed by hand or by a rule</td></tr>
        <tr><td><code>Awaiting</code></td><td>Waiting for another job to finish first</td></tr>
      </tbody>
    </table>
  </div>

  <p>Two of those carry the module's weight.</p>

  <p><strong><code>Processing</code> is a claim, not a lock.</strong> It records that a particular server
  said it was working on this. If that server disappears, nothing releases the claim — another server
  notices the missing heartbeats and puts the job back, and it runs again from the beginning.</p>

  <p><strong><code>Failed</code> is a resting place, not an error channel.</strong> A job that runs out
  of retries sits there indefinitely, in a dashboard nobody has open. Nothing pages anybody. A growing
  failed count is a metric you export and alert on yourself, and it is the single most common thing
  teams discover they never did.</p>

  <h3>What is stored when you enqueue a lambda</h3>

  <pre data-lang="console" data-title="01-storage-and-restart.cs output"><code>   type       Store
   method     Send
   arguments  INV-042</code></pre>

  <p>The lambda was never stored. It is an expression tree the library reads at enqueue time to work out
  what to write down; it is not compiled, captured or kept.</p>

  <div class="callout callout--gotcha">
    <h4>Which makes a job a message to a future version of your application</h4>
    <p>Renaming the method breaks every job already in the queue. Adding a parameter does the same. A
    class passed as an argument is a serialised snapshot that stops deserialising the day somebody adds
    a required property. And during a rolling deploy, jobs written by the new version are executed by
    the old one <em>and the reverse</em> — the same two-version window an API has, and much less
    obvious, because nothing about a method call looks like a contract.</p>
  </div>

  <p>So: <strong>pass identifiers, not objects.</strong> Enqueue the invoice id and load the invoice
  inside the job. The row stays small, the argument never goes stale, and the job reads whatever is true
  when it runs rather than what was true when it was queued.</p>
</section>

<section id="scheduling">
  <h2>Cron, time zones, and the two awkward days</h2>

  <p class="define"><span class="define__term">Cron expression</span> Five fields — minute, hour,
  day-of-month, month, day-of-week — describing a recurring time. Sunday is both 0 and 7.</p>

  <pre data-lang="console" data-title="02-scheduling.cs output"><code>   expression      means                                next two after 2027-06-15 12:00 UTC
   ----------      -----                                -----------------------------------
   * * * * *       every minute                         2027-06-15 12:01, 2027-06-15 12:02
   30 2 * * *      02:30 every day                      2027-06-16 02:30, 2027-06-17 02:30
   0 9 * * 1-5     09:00 on weekdays                    2027-06-16 09:00, 2027-06-17 09:00
   */15 * * * *    every fifteen minutes                2027-06-15 12:15, 2027-06-15 12:30
   0 0 1 * *       midnight on the first of the month   2027-07-01 00:00, 2027-08-01 00:00
   0 3 1 1 *       03:00 on the 1st of January          2028-01-01 03:00, 2029-01-01 03:00</code></pre>

  <p>Two things about the syntax catch people. When <em>both</em> day-of-month and day-of-week are
  restricted, cron uses OR rather than AND — <code>0 0 1 * 0</code> means the first of the month or any
  Sunday. And some libraries accept a six-field variant whose first field is seconds, so the same string
  means different things in different tools: <strong>if an expression is running sixty times too often,
  count the fields.</strong></p>

  <h3>Nine o'clock where?</h3>

  <pre data-lang="console" data-title="02-scheduling.cs output"><code>   time zone                  next occurrence, as UTC
   ---------                  -----------------------
   UTC                        2027-06-16 09:00 UTC
   London (BST in June)       2027-06-16 08:00 UTC
   New York (EDT in June)     2027-06-15 13:00 UTC
   Tokyo                      2027-06-16 00:00 UTC</code></pre>

  <p>A cron expression without a time zone is an incomplete instruction. Most schedulers default to UTC,
  which is the right default and is not what the person writing <code>0 9 * * *</code> meant — they
  meant nine o'clock where the business is.</p>

  <p>Choose deliberately: <strong>UTC if the timing is technical</strong> ("every fifteen minutes",
  "nightly cleanup"), and <strong>a real zone if the timing is human</strong> ("send the statement at
  9am"). Then write the zone down every time, even when it is UTC, so the next person can tell "UTC was
  chosen" from "nobody thought about it".</p>

  <h3>The day a daily job runs at the wrong time</h3>

  <p>In the UK the clocks go forward on 28 March 2027: at 01:00 the local time becomes 02:00, and the
  times between do not happen.</p>

  <pre data-lang="console" data-title="02-scheduling.cs output"><code>   schedule                        the three occurrences either side of the change
   --------                        ----------------------------------------------
   00:30 daily - before the gap    28 00:30   29 00:30   30 00:30
   01:30 daily - INSIDE the gap    28 02:00   29 01:30   30 01:30
   02:30 daily - after the gap     28 02:30   29 02:30   30 02:30</code></pre>

  <p>The job was not skipped and it was not on time — it fired at the instant the gap ended. That is a
  reasonable reading of "run daily at 01:30" and it is not the only one.</p>

  <div class="callout callout--warn">
    <h4>Why thirty minutes late matters more than it looks</h4>
    <p>The gap between that run and the previous day's was 23 hours, not 24. A job that processes
    "everything since the last run" is fine. <strong>A job with a hardcoded 24-hour window silently
    misses thirty minutes of data on that one night</strong>, and nothing about the run looks unusual.</p>
  </div>

  <p>And in October the same clock reading happens twice. Cronos takes the earlier one and does not
  repeat; a scheduler taking the other view would run the job twice, an hour apart, both legitimately at
  "01:30 local". If that job charges a subscription, somebody is billed twice on one night a year.</p>

  <p><strong>The DST problem is the idempotency problem wearing a calendar.</strong> Two runs an hour
  apart are indistinguishable, to the job, from a retry — so a job that is safe to retry is
  automatically safe on both of these days. And if you can, schedule nothing important between 00:30 and
  03:00 local in a zone that observes daylight saving; 04:00 costs nothing and removes both days from
  your life.</p>

  <h3>Runs that were missed</h3>

  <p class="define"><span class="define__term">Misfire</span> Quartz's name for a trigger whose time
  passed while the scheduler was not running, and the policy that decides what to do about it.</p>

  <p class="define"><span class="define__term">Fan-out</span> A job whose only work is to enqueue many
  smaller jobs, so that the unit of work becomes one item rather than the whole batch.</p>

  <p class="define"><span class="define__term">Dual write</span> Writing to two systems that cannot
  share a transaction — here, your database and the job store — so that a failure between them leaves
  the two disagreeing.</p>

  <p class="define"><span class="define__term">Outbox</span> A table in your own database holding
  messages to be sent, written in the same transaction as the data they describe, and drained by a
  separate process. The standard answer to a dual write.</p>

  <p>A nightly job at 02:00, with the service down from 01:00 to 04:00. Three answers are correct for
  different jobs: <strong>run it now</strong> (closing the books — late is better than never),
  <strong>skip it</strong> (a 07:00 digest is not wanted at 11:00), or <strong>run it once, not
  N times</strong> (a five-minute job that missed three hours does not want thirty-six runs queued at
  once, which is a thundering herd aimed at a system that has only only recovered).</p>

  <p>Hangfire's recurring jobs do the first. Quartz makes you pick per trigger, which is the more honest
  design because it makes you answer the question — and the question is always the same one: <strong>is
  this job a command or a heartbeat?</strong> A command missed is still owed. A heartbeat missed is
  gone. Nothing in a cron expression records which you meant.</p>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <p>The fix for the opening incident is three changes, and the measurement is the same run repeated in
  full:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>            Invoiced.Clear();
        }

        Suppressed = 0;
        TransientAttempts = 0;
        PermanentAttempts = 0;
    }

    // Fast, trivial, and safe to repeat: it only enqueues.
    public static void FanOutMonthlyInvoices(string period)
    {
        var client = new BackgroundJobClient();

        for (int n = 1; n &lt;= 20; n++)
        {
            string account = $"ACC-{n:000}";

            client.Create(() =&gt; SendInvoice(account, period), new EnqueuedState("invoices"));
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

            if (attempt &lt; FailTransientlyUntilAttempt)
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
    }</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   AFTER THE RUN, AND A FULL REPEAT OF IT

     accounts                              20
     invoices sent                         19
     accounts invoiced more than once      0
     duplicate sends the guard refused     19
     attempts on the transiently failing   4
     attempts on the permanently broken    8

   WHAT THE MONITORING API WILL TELL YOU

     enqueued    0
     processing  0
     scheduled   0
     succeeded   39
     FAILED      2</code></pre>

  <ul>
    <li><strong>The recurring job only fans out.</strong> Its body is a loop that enqueues, so it
    finishes in milliseconds — an interrupted fan-out costs nothing and a repeated one enqueues
    duplicates the guard refuses.</li>
    <li><strong>The unit of work is one account.</strong> A failure costs one account and a retry
    repeats one account. The unit of work and the unit of retry are the same thing, so choosing how big
    a job is chooses how much a failure costs.</li>
    <li><strong>The guard is the write.</strong> Not "select then insert" with a gap in the middle — an
    insert that fails when the row exists, so two workers racing both call it and exactly one wins.</li>
    <li><strong>The retry policy was chosen, per job.</strong> The transient failure succeeded on its
    third attempt; the permanently broken account used its attempts and landed in
    <code>Failed</code>.</li>
  </ul>

  <p>And the server that runs it, with the queue list that made the difference in exercise 4:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>JobStorage.Current = new InMemoryStorage();

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
// anything is enqueued, so no job can race the configuration.</code></pre>

  <div class="callout callout--gotcha">
    <h4>A retry is re-enqueued on the default queue</h4>
    <p>Not the queue the job started on. A server whose <code>Queues</code> list does not include
    <code>default</code> will never run any retry in the system — which looks exactly like jobs silently
    vanishing, and cost two hours while this module was being written.</p>
  </div>
</section>

<section id="distribution">
  <h2>Several servers, one storage</h2>

  <p>The previous module ended on a limitation it could not fix: <code>AddHostedService</code> gives you
  one loop per process, so three replicas are three loops with nothing coordinating them. A shared job
  store fixes that, and it is worth being precise about which half it fixes.</p>

  <h3>What distribution you get for free</h3>

  <p>Every server polls the same storage and claims jobs atomically, so <strong>a queued job runs on
  exactly one server</strong> without any coordination you write. Adding a replica adds workers; removing
  one leaves its claimed jobs to be requeued. That is genuine distributed execution and it costs
  nothing.</p>

  <p>Recurring jobs are the same: the schedule is a row, and whichever server notices it is due takes a
  distributed lock before enqueueing, so <strong>a recurring job produces one job per occurrence
  regardless of replica count</strong>. This is exactly the problem the previous module could not solve
  with a <code>PeriodicTimer</code>.</p>

  <h3>What it does not give you</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the lock ends when the enqueue does, not when the work does"><code>// Two servers cannot BOTH enqueue this occurrence. They can both
// RUN the resulting job's work concurrently with a retry of it,
// or with a requeued copy after a deploy.
RecurringJob.AddOrUpdate("rebuild-search-index",
    () =&gt; Search.RebuildIndex(), "0 * * * *");</code></pre>

  <p>The lock covers the <em>enqueue</em>, not the execution. A job can still overlap with a retry of
  itself, with a requeued copy after a deployment, or with the next occurrence if the previous one is
  still running. If overlap is genuinely unsafe, say so:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - one execution at a time, enforced in storage"><code>[DisableConcurrentExecution(timeoutInSeconds: 300)]
[AutomaticRetry(Attempts = 3)]
public static void RebuildIndex()
{
    // A distributed lock is taken for the duration. A second execution
    // waits up to five minutes for the lock and then fails.
}</code></pre>

  <div class="callout callout--warn">
    <h4>That attribute is a lock, with everything a lock implies</h4>
    <p>The timeout is a real decision: too short and legitimate concurrent attempts fail, too long and a
    stuck job blocks its own schedule for as long as the timeout. And a lock held by a server that dies
    is released by expiry, not by anybody noticing — so the window in which two executions can overlap
    is not zero, it is bounded by the lock's own timeout.</p>
  </div>

  <p>Which leaves the honest summary: <strong>a job store distributes work correctly and cannot make
  your work safe.</strong> Exactly-once execution is not available, so the guard in the job is doing the
  real work and every mechanism above only narrows the window.</p>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>A job that is not safe to run twice</h3>

  <p>The incident. At-least-once is not a weakness — it is the strongest guarantee available without a
  transaction spanning your database and the invoice provider, and there is no such thing. The job has
  to be safe to run twice, and that is the contract rather than a mitigation for a rare case.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - one failure, one deploy, or one retry repeats everything"><code>public static void SendMonthlyInvoices()
{
    foreach (Account account in Accounts.All())
    {
        // No guard, no resumption, and eight thousand of these in one job.
        Gateway.SendInvoice(account.Id);
    }
}</code></pre>

  <h3>Retries on work that is not idempotent</h3>

  <pre data-lang="console" data-title="03-production.cs output"><code>   attempts made                          10
   invoices sent in total                 130
   distinct accounts invoiced             13
   most times any one account was sent    10</code></pre>

  <p>Ten attempts is the default and nobody chose it. Each retry re-sent the thirteen invoices that had
  already succeeded, then hit the same bad account again. <strong>Retry only helps work that is safe to
  repeat</strong>; on work that is not, it multiplies the damage — and it is on by default, so it is
  multiplying the damage in jobs nobody has thought about.</p>

  <p>Note also that the retries were useless: a missing billing address will still be missing on the
  tenth attempt. Retrying helps with <em>transient</em> failures and does nothing about a bad record
  except repeat the side effects around it.</p>

  <h3>One big job instead of many small ones</h3>

  <p>The unit of work and the unit of retry are the same thing. Eight thousand accounts in one job means
  a single failure anywhere loses the whole run.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - two breaking changes to a stored contract"><code>// Was: public static void SendInvoice(string accountId)
public static void SendInvoiceAsync(string accountId, string correlationId)
{
    // Every job already in storage names SendInvoice and carries one
    // argument. None of them can be resolved any more.
}</code></pre>

  <h3>Renaming a job method</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   what the stored job names        OldVersion.SendInvoice("ACC-001")
   what the new version provides    NewVersion.SendInvoiceAsync(string, string)
   result                           the new assembly has no method called 'SendInvoice'</code></pre>

  <p>The compiler cannot help, because nothing in the new assembly refers to the old name — the
  reference lives in the database.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a serialised snapshot that goes stale and stops parsing"><code>// The whole object is serialised into the job row. It is the invoice as
// it was when queued, not as it is when the job runs - and adding a
// required property to Invoice breaks every job already stored.
BackgroundJob.Enqueue(() =&gt; Billing.SendInvoice(invoice));</code></pre>

  <h3>Enqueueing inside a transaction that has not committed</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   ordering                                     job found the invoice
   --------                                     ---------------------
   enqueue inside the transaction               NO - not found
   enqueue after the commit                     yes</code></pre>

  <p>The job store and your database are two systems, and the enqueue is not part of your transaction.
  Moving the enqueue after the commit fixes this and creates a quieter one: if the process dies between
  the commit and the enqueue, the invoice exists and no job will ever send it.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the worker can start before the commit lands"><code>using var transaction = await database.BeginTransactionAsync(cancellationToken);

database.Invoices.Add(invoice);
await database.SaveChangesAsync(cancellationToken);

// The job store is a different system. This job is visible to workers
// now, and the row it needs is not committed yet.
BackgroundJob.Enqueue(() =&gt; Billing.SendInvoice(invoice.Id));

await transaction.CommitAsync(cancellationToken);</code></pre>

  <h3>Fast and slow work in the same queue</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   configuration                       emails sent   slowest email waited
   -------------                       -----------   --------------------
   one queue, four workers                      20                 834 ms
   two queues, dedicated workers                20                   5 ms</code></pre>

  <p>Nothing failed and nothing retried — the emails were queued behind the reports. Which is why the
  dashboard shows a healthy system with a long queue, and the alert that fires is "password resets not
  arriving", from a human.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - one queue, and the password resets are behind the reports"><code>BackgroundJob.Enqueue(() =&gt; Reports.Rebuild(month));
BackgroundJob.Enqueue(() =&gt; Email.SendPasswordReset(userId));</code></pre>

  <h3>Assuming <code>Failed</code> tells somebody</h3>

  <p>It is a resting place. Jobs sit there indefinitely and nothing pages anybody.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>Start from the job's state history, not the logs.</strong> Every transition is recorded
    with a timestamp and a reason — <code>Enqueued</code> at 02:00, <code>Processing</code> on server X,
    <code>Enqueued</code> again at 02:06. That second enqueue <em>is</em> the requeue, and it is visible
    without any logging of your own.</li>
    <li><strong>For duplicate side effects, look for a job whose final state is
    <code>Succeeded</code>.</strong> The incident has no failure in it. A job requeued mid-run and then
    completing looks identical to a job that ran once.</li>
    <li><strong>For "the job stopped running", check the recurring job's last execution, not the
    server.</strong> A recurring job whose method no longer resolves fails at enqueue time, and the
    schedule sits there looking configured.</li>
    <li><strong>For a job that fails immediately with nothing about your domain in the message</strong>,
    suspect the signature. A rename or a new parameter breaks every row already in the queue.</li>
    <li><strong>For a queue that is not draining, compare the queue names.</strong> A job enqueued to a
    queue no server is watching sits in <code>Enqueued</code> forever — and retries go to
    <code>default</code>, not to the originating queue.</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>The failed job count, exported and alerted on.</strong> Every team discovers this
      eventually, usually by finding a dashboard with four hundred failures going back months.</li>
      <li><strong>The age of the oldest enqueued job.</strong> Depth is ambiguous — a big queue may be a
      busy morning. A job that has been waiting an hour is not.</li>
      <li><strong>Retry counts as a rate, by attempt number.</strong> A trickle of first retries is a
      healthy system absorbing transient failures. A rise in second and third attempts means the retries
      are not working, which is a different problem with a different fix.</li>
      <li><strong>Jobs requeued after a server vanished.</strong> This is the incident's signal, it is
      available, and it correlates exactly with your deployments. If it is not zero after every deploy,
      you have jobs running twice.</li>
    </ul>
  </div>

  <p>And a review question for every job: <strong>what happens if this runs twice?</strong> If the
  answer is anything other than "nothing", the job is not finished.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"The scheduler guarantees my job runs once"</h4>
    <p>It guarantees at-least-once. Exactly-once across two systems is not available, and a requeue
    after a lost server is the feature that makes the store worth having.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Retries make the system more reliable"</h4>
    <p>On idempotent work, yes. On work that is not, they multiply the damage — measured at ten copies
    of everything before the failure — and they are on by default.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A failed job will get someone's attention"</h4>
    <p><code>Failed</code> is a resting place. Nothing pages anybody, and the dashboard is not open.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Enqueueing a lambda captures the code"</h4>
    <p>It stores a type name, a method name and JSON arguments. The lambda is read at enqueue time and
    discarded, which is why a rename breaks jobs already queued.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Cron handles daylight saving for me"</h4>
    <p>Something handles it, and which something and how varies by library. Measured here: a 01:30 daily
    job fires at 02:00 on the spring-forward day. That is a choice somebody else made on your
    behalf.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Enqueueing inside my transaction is fine, it is all one operation"</h4>
    <p>The job store is a separate system unless you have deliberately made it your own database. The
    worker can start before your commit lands.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"One queue is simpler"</h4>
    <p>It is, until a burst of slow work starves the fast work. Measured: the slowest email waited 834 ms
    against 5 ms with the queues separated.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A job scheduler moves your failure modes from "lost" to "repeated"</h4>
    <p>That is the trade and it is worth making explicitly. A <code>BackgroundService</code> loses seven
    of twelve items when the process stops. A job store loses none — and pays for that by running some
    of them twice. <strong>Neither is safer in the abstract; they fail in opposite directions</strong>,
    and the one you want depends on whether a duplicate invoice or a missing invoice is worse for the
    work in front of you.</p>
  </div>

  <p>The second reason is that idempotency stops being a nice-to-have the moment work is durable. In a
  request handler, "this might run twice" is a retry the caller controls. In a job system it is the
  delivery guarantee, applied by infrastructure, at times you do not choose — during a deploy, after a
  node dies, on one night in October. Every job is written under that contract, and most are written by
  someone who has not noticed.</p>

  <p>The third is that a job is a serialised message, and that makes your method signatures a wire
  format. Nobody reviews a rename as a breaking change, because nothing about
  <code>SendInvoice(string)</code> looks like a published contract — and yet during every rolling deploy
  two versions of your code are reading each other's jobs.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A daily sales report is scheduled with <code>0 9 * * *</code> and is meant to be in inboxes by
    nine. From late March to late October it arrives at ten. The schedule has not been touched.</p>
    <p>What is happening?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   date            scheduled in UTC      that is, in London
   ----            ----------------      ------------------
   January (GMT)   2027-01-15 09:00 UTC     09:00 local
   July (BST)      2027-07-15 09:00 UTC     10:00 local</code></pre>
        <p>The schedule is in UTC and the expectation is in local time. Nine o'clock UTC is nine o'clock
        in London in January and ten o'clock in July.</p>
        <p>Nothing changed in March — the schedule was always UTC and the clocks moved underneath it.
        Which is why this is reported as "it started happening" rather than "it has always been wrong":
        the bug was introduced the day the job was written and became visible on the last Sunday of
        March.</p>
        <pre data-lang="csharp" data-net="10" data-title="Right - say which nine o'clock you meant"><code>RecurringJob.AddOrUpdate("daily-report", () =&gt; Reports.SendDaily(),
    "0 9 * * *", new RecurringJobOptions
    {
        TimeZone = TimeZoneInfo.FindSystemTimeZoneById("Europe/London")
    });</code></pre>
        <p>And the rule that prevents the whole class: write the zone every time, even when it is UTC,
        so the next person can tell the difference between "UTC was chosen" and "nobody thought about
        it".</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A release renames <code>SendInvoice</code> to <code>SendInvoiceAsync</code> and adds a parameter.
    Tests pass. After the deploy, several hundred jobs fail immediately with errors that mention no
    business logic at all.</p>
    <p>Why, and what should the release have done instead?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   what the stored job names        OldVersion.SendInvoice("ACC-001")
   what the new version provides    NewVersion.SendInvoiceAsync(string, string)
   result                           the new assembly has no method called 'SendInvoice'</code></pre>
        <p>A queued job is a message to a future version of your code, and the message names a type, a
        method and an argument list. The deployment changed all three. The compiler cannot help, because
        the reference lives in the database — this is a binary compatibility problem wearing the clothes
        of an ordinary rename, and a rename is the refactor people do most freely.</p>
        <p>Treat a job signature the way you would treat an API contract. <strong>Add, do not
        change</strong>: keep the old method, have it call the new one, and delete it after the queue
        has drained past your longest retry window — which for a ten-attempt policy can be days.
        <strong>Pass identifiers, not objects</strong>, because a serialised DTO gains a required
        property one day and stops deserialising for everything already queued. And <strong>keep job
        methods in a thin, boring class</strong> whose only job is to be nameable.</p>
        <p>Remember the rolling window too: during a deploy, jobs written by the new version are
        executed by the old one and the reverse. Both directions have to work.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>A request creates an invoice and enqueues a job to send it. Occasionally — a few times a day,
    under load — the job fails with "invoice not found". The invoice is definitely there afterwards.</p>
    <p>What is happening, and why does moving the enqueue not fully fix it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   ordering                                     job found the invoice
   --------                                     ---------------------
   enqueue inside the transaction               NO - not found
   enqueue after the commit                     yes</code></pre>
        <p>The job store and your database are two systems, and the enqueue is not part of your
        transaction. A worker can pick the job up and look for a row that has not been written yet. It
        is intermittent because it is a race — under light load the worker rarely wins, under load it
        regularly does.</p>
        <p>Enqueueing after the commit fixes the symptom and creates a second one: if the process dies
        between the commit and the enqueue, the invoice exists and no job will ever send it. You have
        traded "sometimes too early" for "sometimes never", which is quieter and worse.</p>
        <p>This is the dual-write problem and it has no solution inside the request handler. The
        <strong>outbox</strong> is the general answer: write the job into your own database in the same
        transaction as the invoice, and have a separate process read that table and enqueue. A cheaper
        partial answer is a job that <strong>retries on "not found"</strong> rather than failing — which
        covers the early case and not the lost one.</p>
        <p>And if the job storage is the same database, an enqueue can join your ambient transaction and
        the problem disappears entirely. The problem is created by the two stores being separate.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A service runs two kinds of job: sending an email, which takes milliseconds, and rebuilding a
    monthly report, which takes minutes. One afternoon somebody triggers eight report rebuilds. Password
    reset emails stop arriving for twenty minutes.</p>
    <p>Nothing failed. What happened, and what are the fixes in order of strength?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   configuration                       emails sent   slowest email waited
   -------------                       -----------   --------------------
   one queue, four workers                      20                 834 ms
   two queues, dedicated workers                20                   5 ms</code></pre>
        <p>A queue is a shared resource and workers are its capacity. Four workers and eight long jobs
        means every worker is busy for a long time, and short jobs queued behind them wait for the whole
        thing. Nothing failed and nothing retried — the emails were queued, which is why the dashboard
        shows a healthy system with a long queue and the alert comes from a human.</p>
        <p>Separate queues separate the capacity, and the <code>Queues</code> list is also a priority
        order: a server given <code>["emails", "reports"]</code> empties emails before it looks at
        reports.</p>
        <p>Two refinements, in increasing strength. <strong>Separate processes beat separate
        queues</strong> — queues divide the workers, a separate deployment divides the memory, the CPU
        and the failure domain too. And <strong>a long job is often several short ones</strong>: a
        report rebuild that fans out per section is interruptible, resumable, parallel, and stops
        occupying a worker for minutes — the same fan-out that fixed the invoicing incident, for a
        different reason.</p>
        <p>The principle is older than job schedulers: do not put work with different latency
        requirements in the same queue. It is the same reason a supermarket has a basket-only till.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What does a job store buy you that an in-memory queue does not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The work outlives the process that was asked to do it. Measured:
        seven of twelve items lost on a restart against none. Retries, scheduling and distribution are
        all consequences of the work being a durable record.</p></div>
      </details></li>

    <li><p>Why did the invoicing job run twice, given that nothing failed?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A deployment stopped the server holding the job. <code>Processing</code>
        is a claim rather than a lock, so when the server stopped reporting the job was requeued and
        restarted from the beginning. Its final state was <code>Succeeded</code>.</p></div>
      </details></li>

    <li><p>What delivery guarantee does a job scheduler give, and why not a stronger one?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>At-least-once. Exactly-once would need a transaction spanning the
        job store and whatever the job affects — your database, a payment gateway — and no such
        transaction exists.</p></div>
      </details></li>

    <li><p>Why is turning retries on for a non-idempotent job worse than leaving them off?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Each attempt repeats every side effect before the failure point.
        Measured: ten attempts produced 130 sends across 13 accounts, with one account invoiced ten
        times.</p></div>
      </details></li>

    <li><p>What is actually written to storage when you call
      <code>BackgroundJob.Enqueue(() =&gt; Work.Send("X"))</code>?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A type name, a method name, and the arguments as JSON. The lambda
        is an expression tree read at enqueue time and then discarded.</p></div>
      </details></li>

    <li><p>Why does renaming a job method break jobs that are already queued?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The stored row still names the old method, and the new assembly no
        longer has it. Nothing in code refers to the old name, so the compiler cannot warn — the
        reference lives in the database.</p></div>
      </details></li>

    <li><p>A daily job scheduled at 01:30 local, on the spring-forward day. What happened?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It fired at 02:00 — the instant the gap ended. Not skipped, and not
        on time. The interval since the previous run was 23 hours, which breaks any job using a
        hardcoded 24-hour window.</p></div>
      </details></li>

    <li><p>Why is a job that is safe to retry automatically safe across both daylight-saving days?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Two runs an hour apart are indistinguishable, to the job, from a
        retry. The DST problem is the idempotency problem wearing a calendar.</p></div>
      </details></li>

    <li><p>Give the three defensible policies for a run missed during an outage, and the question that
      picks between them.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Run it now, skip it, or run it once rather than N times. The
        question is whether the job is a command or a heartbeat: a command missed is still owed, a
        heartbeat missed is gone.</p></div>
      </details></li>

    <li><p>Why does enqueueing inside an uncommitted transaction fail intermittently?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The job store is a separate system, so the worker can start before
        the commit lands. It is a race the worker rarely wins under light load and often wins under
        load.</p></div>
      </details></li>

    <li><p>What does fanning out a large job buy, beyond parallelism?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It makes the unit of work small. The unit of work and the unit of
        retry are the same thing, so a failure costs one item, a retry repeats one item, and a
        deployment abandons at most one per worker.</p></div>
      </details></li>

    <li><p>Which queue does a retry go to?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>default</code> — not the queue the job started on. A server
        whose <code>Queues</code> list omits <code>default</code> never runs any retry, which looks like
        jobs vanishing.</p></div>
      </details></li>
  </ol>
</section>
`
});
