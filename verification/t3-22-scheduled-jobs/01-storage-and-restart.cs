// 01-storage-and-restart.cs — What the storage buys, what the job state machine
// is, and what happens to work that was in progress when the process went away.
//
// Run:  dotnet run 01-storage-and-restart.cs -c Release
//
// EXACT vs RATIO: the counts and state names are deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Hangfire.Core@1.8.21
#:package Hangfire.InMemory@1.0.0
#:package Newtonsoft.Json@13.0.4

using System.Collections.Concurrent;
using Hangfire;
using Hangfire.InMemory;
using Hangfire.Storage;
using Hangfire.Storage.Monitoring;

Console.WriteLine("Storage, states, and what a restart costs");
Console.WriteLine();

await WhatARestartCosts();
TheStateMachine();
await WhatTheArgumentsAre();

// ---------------------------------------------------------------------------
static async Task WhatARestartCosts()
{
    Console.WriteLine("1. Twelve pieces of work, and a process that stops halfway");
    Console.WriteLine();
    Console.WriteLine("   The same twelve invoices, queued two ways, with the process stopping");
    Console.WriteLine("   after roughly a third of them.");
    Console.WriteLine();

    // --- The in-memory queue a BackgroundService would use.
    var inMemory = new ConcurrentQueue<string>();

    for (int n = 1; n <= 12; n++)
    {
        inMemory.Enqueue($"INV-{n:000}");
    }

    var sentBeforeStop = new List<string>();
    using (var cts = new CancellationTokenSource())
    {
        Task loop = Task.Run(async () =>
        {
            while (!cts.Token.IsCancellationRequested && inMemory.TryDequeue(out string? invoice))
            {
                await Task.Delay(40, CancellationToken.None);

                lock (sentBeforeStop)
                {
                    sentBeforeStop.Add(invoice);
                }
            }
        });

        await Task.Delay(200);
        cts.Cancel();

        try
        {
            await loop;
        }
        catch (OperationCanceledException)
        {
        }
    }

    // The process ends. Whatever was still in that queue is gone with it.
    int inMemoryLost = inMemory.Count;

    // --- The same twelve, in a job store.
    var storage = new InMemoryStorage();
    JobStorage.Current = storage;

    Store.Reset();

    for (int n = 1; n <= 12; n++)
    {
        BackgroundJob.Enqueue(() => Store.Send($"INV-{n:000}"));
    }

    // A server, stopped part way through - which is what a deployment is.
    var first = new BackgroundJobServer(new BackgroundJobServerOptions
    {
        WorkerCount = 1,
        SchedulePollingInterval = TimeSpan.FromMilliseconds(50)
    });

    await Task.Delay(200);
    first.Dispose();

    int sentByFirstServer = Store.Sent.Count;
    int stillQueued = Queued(storage);

    // The replacement process, over the same storage.
    var second = new BackgroundJobServer(new BackgroundJobServerOptions
    {
        WorkerCount = 1,
        SchedulePollingInterval = TimeSpan.FromMilliseconds(50)
    });

    await Task.Delay(1200);
    second.Dispose();

    Console.WriteLine("   queue                  done before stop   still queued   done after restart   LOST");
    Console.WriteLine("   -----                  ----------------   ------------   ------------------   ----");
    Console.WriteLine($"   ConcurrentQueue        {sentBeforeStop.Count,16}   {inMemoryLost,12}   " +
        $"{0,18}   {inMemoryLost,4}");
    Console.WriteLine($"   Hangfire storage       {sentByFirstServer,16}   {stillQueued,12}   " +
        $"{Store.Sent.Count - sentByFirstServer,18}   {12 - Store.Sent.Count,4}");

    Console.WriteLine();
    Console.WriteLine("   THE IN-MEMORY QUEUE LOST EVERYTHING IT HAD NOT REACHED. That is not a");
    Console.WriteLine("   bug in ConcurrentQueue - it is what 'in memory' means. The work existed");
    Console.WriteLine("   only as items in a collection owned by a process, and the process is");
    Console.WriteLine("   gone.");
    Console.WriteLine();
    Console.WriteLine("   THE STORED JOBS WERE PICKED UP BY THE NEXT PROCESS. Nothing was");
    Console.WriteLine("   transferred and nothing was handed over: the second server queried the");
    Console.WriteLine("   same storage and found rows that had never been marked as done.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE WHOLE OF WHAT A JOB STORE BUYS, and it is worth being");
    Console.WriteLine("   precise about it: THE WORK OUTLIVES THE PROCESS THAT WAS ASKED TO DO");
    Console.WriteLine("   IT. Everything else in this module - retries, scheduling, distribution");
    Console.WriteLine("   - is a consequence of the work being a durable record rather than a");
    Console.WriteLine("   call stack.");
    Console.WriteLine();
    Console.WriteLine("   AND IT IS WHY THE STORAGE IS THE DECISION. In-memory storage, as used");
    Console.WriteLine("   in this file, gives you none of it: the moment the process ends the");
    Console.WriteLine("   jobs go with it, exactly like the ConcurrentQueue. It is for tests and");
    Console.WriteLine("   for demonstrations like this one, where 'the process' is a single");
    Console.WriteLine("   program and the restart is simulated inside it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheStateMachine()
{
    Console.WriteLine("2. The states a job moves through");
    Console.WriteLine();
    Console.WriteLine("   A job is a row with a state, and every transition is written down");
    Console.WriteLine("   before it is acted on. That is the mechanism behind everything else.");
    Console.WriteLine();
    Console.WriteLine("     Enqueued     waiting for a free worker");
    Console.WriteLine("     Scheduled    waiting for a time to arrive - a delay, or a retry");
    Console.WriteLine("     Processing   a named server and worker has claimed it");
    Console.WriteLine("     Succeeded    finished; kept for a while so you can see it happened");
    Console.WriteLine("     Failed       out of retries; kept forever until somebody looks");
    Console.WriteLine("     Deleted      removed by hand or by a rule");
    Console.WriteLine("     Awaiting     waiting for another job to finish first");
    Console.WriteLine();
    Console.WriteLine("   TWO OF THOSE ARE WORTH DWELLING ON.");
    Console.WriteLine();
    Console.WriteLine("     Processing IS A CLAIM, NOT A LOCK. It records that a particular");
    Console.WriteLine("     server said it was working on this. If that server disappears -");
    Console.WriteLine("     killed, crashed, network-partitioned - nothing releases the claim.");
    Console.WriteLine("     Another server notices the first one has stopped sending heartbeats");
    Console.WriteLine("     and puts the job back. THE JOB THEN RUNS AGAIN, FROM THE BEGINNING,");
    Console.WriteLine("     and that is the module's incident.");
    Console.WriteLine();
    Console.WriteLine("     Failed IS A RESTING PLACE, NOT AN ERROR CHANNEL. A job that runs out");
    Console.WriteLine("     of retries sits in Failed indefinitely, visible in a dashboard");
    Console.WriteLine("     nobody has open. Nothing pages anybody. A growing Failed count is a");
    Console.WriteLine("     metric you have to export and alert on yourself, and it is the");
    Console.WriteLine("     single most common thing teams discover they never did.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatTheArgumentsAre()
{
    Console.WriteLine("3. What is actually stored when you enqueue a lambda");
    Console.WriteLine();

    var storage = new InMemoryStorage();
    JobStorage.Current = storage;

    Store.Reset();

    string id = BackgroundJob.Enqueue(() => Store.Send("INV-042"));

    IMonitoringApi monitoring = storage.GetMonitoringApi();
    JobDetailsDto details = monitoring.JobDetails(id)!;

    Console.WriteLine($"   type       {details.Job?.Type.FullName}");
    Console.WriteLine($"   method     {details.Job?.Method.Name}");
    Console.WriteLine($"   arguments  {string.Join(", ", details.Job?.Args ?? [])}");
    Console.WriteLine();
    Console.WriteLine("   THE LAMBDA WAS NEVER STORED. What went into storage is a type name, a");
    Console.WriteLine("   method name, and the arguments as JSON. The lambda is an expression");
    Console.WriteLine("   tree that the library reads at enqueue time to work out what to write");
    Console.WriteLine("   down; it is not compiled, captured or kept.");
    Console.WriteLine();
    Console.WriteLine("   WHICH MAKES A JOB A MESSAGE TO A FUTURE VERSION OF YOUR APPLICATION,");
    Console.WriteLine("   and every rule about message formats now applies to your method");
    Console.WriteLine("   signatures:");
    Console.WriteLine();
    Console.WriteLine("     RENAMING THE METHOD BREAKS EVERY JOB ALREADY IN THE QUEUE. The stored");
    Console.WriteLine("     row still says the old name, and the deployment that renamed it can");
    Console.WriteLine("     no longer resolve it. Those jobs fail, permanently, with a");
    Console.WriteLine("     resolution error rather than anything about your domain.");
    Console.WriteLine();
    Console.WriteLine("     ADDING A PARAMETER DOES THE SAME. The stored argument list has the");
    Console.WriteLine("     old arity. Add a parameter with a default and the signature the");
    Console.WriteLine("     scheduler looks for still does not match.");
    Console.WriteLine();
    Console.WriteLine("     A CLASS AS AN ARGUMENT IS A SERIALISED SNAPSHOT. It is the object as");
    Console.WriteLine("     it was when you enqueued, not as it is when the job runs, and adding");
    Console.WriteLine("     a required property to it breaks deserialisation of everything");
    Console.WriteLine("     already queued.");
    Console.WriteLine();
    Console.WriteLine("   SO THE RULE IS: PASS IDENTIFIERS, NOT OBJECTS. Enqueue the invoice id");
    Console.WriteLine("   and load the invoice inside the job. The row stays small, the argument");
    Console.WriteLine("   never goes stale, and the job reads whatever is true at the moment it");
    Console.WriteLine("   runs rather than what was true when it was queued.");
    Console.WriteLine();
    Console.WriteLine("   AND TREAT A DEPLOYMENT WITH A NON-EMPTY QUEUE AS A COMPATIBILITY");
    Console.WriteLine("   PROBLEM. For the duration of a rolling deploy, jobs written by the new");
    Console.WriteLine("   version are being executed by the old one and the reverse. That is the");
    Console.WriteLine("   same two-version window an API has during a deploy, and it is much");
    Console.WriteLine("   less obvious because nothing about a method call looks like a");
    Console.WriteLine("   contract.");
    Console.WriteLine();

    await Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static int Queued(JobStorage storage) =>
    (int)storage.GetMonitoringApi().EnqueuedCount("default");

// ---------------------------------------------------------------------------
public static class Store
{
    public static readonly List<string> Sent = [];

    public static void Reset()
    {
        lock (Sent)
        {
            Sent.Clear();
        }
    }

    public static void Send(string invoiceId)
    {
        Thread.Sleep(40);

        lock (Sent)
        {
            Sent.Add(invoiceId);
        }
    }
}
