// 00-smallest.cs — The smallest job scheduler, and the four things it does that
// a loop in a BackgroundService does not.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: the counts and job states are deterministic. The millisecond
// figures are machine-specific.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false
#:package Hangfire.Core@1.8.21
#:package Hangfire.InMemory@1.0.0
#:package Newtonsoft.Json@13.0.4

using Hangfire;
using Hangfire.InMemory;
using Hangfire.Storage;
using Hangfire.Storage.Monitoring;

// The whole setup: a storage, and a server that pulls work out of it.
GlobalConfiguration.Configuration.UseInMemoryStorage();

using var server = new BackgroundJobServer(new BackgroundJobServerOptions
{
    // One worker so the ordering in this file is easy to follow. The default
    // is based on processor count.
    WorkerCount = 1,

    // How often the server looks for newly scheduled work. The default is
    // fifteen seconds, which is too slow for a file that runs in seconds.
    SchedulePollingInterval = TimeSpan.FromMilliseconds(100)
});

Console.WriteLine("The smallest job scheduler");
Console.WriteLine();

// 1. Fire and forget: run this as soon as a worker is free.
string enqueued = BackgroundJob.Enqueue(() => Work.SendInvoice("INV-001"));

// 2. Delayed: run this later.
string scheduled = BackgroundJob.Schedule(() => Work.SendInvoice("INV-002"),
    TimeSpan.FromMilliseconds(400));

// 3. A job that fails, so the retry behaviour is visible.
string failing = BackgroundJob.Enqueue(() => Work.AlwaysFails("INV-003"));

Console.WriteLine("   three jobs created, before any of them has run:");
Console.WriteLine();
Console.WriteLine($"   {"job",-10} {"id",-26} state");
Console.WriteLine($"   {new string('-', 10)} {new string('-', 26)} -----");
Console.WriteLine($"   {"enqueued",-10} {enqueued,-26} {StateOf(enqueued)}");
Console.WriteLine($"   {"scheduled",-10} {scheduled,-26} {StateOf(scheduled)}");
Console.WriteLine($"   {"failing",-10} {failing,-26} {StateOf(failing)}");

await Task.Delay(1500);

Console.WriteLine();
Console.WriteLine("   after a second and a half:");
Console.WriteLine();
Console.WriteLine($"   {"enqueued",-10} {enqueued,-26} {StateOf(enqueued)}");
Console.WriteLine($"   {"scheduled",-10} {scheduled,-26} {StateOf(scheduled)}");
Console.WriteLine($"   {"failing",-10} {failing,-26} {StateOf(failing)}");
Console.WriteLine();
Console.WriteLine($"   invoices actually sent   {string.Join(", ", Work.Sent)}");
Console.WriteLine($"   attempts on INV-003      {Work.Attempts}");

Console.WriteLine();
Console.WriteLine("   FOUR THINGS THAT HAPPENED WITHOUT BEING WRITTEN:");
Console.WriteLine();
Console.WriteLine("     1. THE WORK WAS WRITTEN DOWN BEFORE IT RAN. Enqueue returned an id and");
Console.WriteLine("        the job existed, in storage, as a record - before any worker touched");
Console.WriteLine("        it. A loop in a BackgroundService has no equivalent moment: the work");
Console.WriteLine("        is a method call that either happens or does not.");
Console.WriteLine();
Console.WriteLine("     2. THE FAILURE WAS RETRIED. INV-003 threw, and the job did not");
Console.WriteLine("        disappear - it went back into storage with a scheduled retry. The");
Console.WriteLine("        default is ten attempts with a growing delay, and nobody chose it.");
Console.WriteLine();
Console.WriteLine("     3. THE DELAY SURVIVED OUTSIDE THE PROCESS. 'Run this in four hundred");
Console.WriteLine("        milliseconds' is a row in storage with a timestamp on it, not a");
Console.WriteLine("        Task.Delay held in memory by whoever asked for it.");
Console.WriteLine();
Console.WriteLine("     4. THE ARGUMENTS WERE SERIALISED. () => Work.SendInvoice(\"INV-001\") was");
Console.WriteLine("        not stored as a delegate - it was stored as a type name, a method");
Console.WriteLine("        name and a JSON argument list, to be reconstructed later, possibly");
Console.WriteLine("        by a different process running different code.");
Console.WriteLine();
Console.WriteLine("   THE FOURTH IS THE ONE THAT BITES, and it is the price of the other three:");
Console.WriteLine("   a job is a message to a future version of your application, and every");
Console.WriteLine("   constraint that applies to a message format now applies to your method");
Console.WriteLine("   signatures.");

server.Dispose();

// ---------------------------------------------------------------------------
static string StateOf(string jobId)
{
    IMonitoringApi monitoring = JobStorage.Current.GetMonitoringApi();
    JobDetailsDto? details = monitoring.JobDetails(jobId);

    return details?.History.FirstOrDefault()?.StateName ?? "unknown";
}

// ---------------------------------------------------------------------------
// The work itself. Public and static, because that is what a job scheduler can
// reconstruct from a stored type and method name.
public static class Work
{
    public static readonly List<string> Sent = [];

    public static int Attempts;

    public static void SendInvoice(string invoiceId)
    {
        lock (Sent)
        {
            Sent.Add(invoiceId);
        }
    }

    public static void AlwaysFails(string invoiceId)
    {
        Interlocked.Increment(ref Attempts);

        throw new InvalidOperationException($"The gateway refused {invoiceId}.");
    }
}
