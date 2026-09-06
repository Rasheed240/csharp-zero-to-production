// 05-minimal-example.cs — One flag system with every decision made: a typed
// registry with owners and removal dates, evaluation ordered so exclusions
// win, a per-request snapshot, and the test that fails when a flag is overdue.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every value and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The snapshot needs the request in order to find the subject.
builder.Services.AddHttpContextAccessor();

var state = new FlagState();
builder.Services.AddSingleton(state);

// DECISION 1: the snapshot is per request. Every read within one request
// agrees, and the next request sees any change.
builder.Services.AddScoped<FlagSnapshot>();

var app = builder.Build();

app.MapGet("/v1/checkout", (FlagSnapshot flags) => Results.Ok(new
{
    // DECISION 2: read through a typed accessor. The key is written once, in
    // the registry, so a typo is a compile error rather than a silent false.
    checkout = flags.IsEnabled(Flag.NewCheckout) ? "new" : "old",

    // Read a second time in the same request, which the snapshot makes safe.
    pricing = flags.IsEnabled(Flag.NewCheckout) ? "new" : "old"
}));

// DECISION 3: an ops toggle is read live, not snapshotted, because it exists
// to be flipped during an incident.
app.MapPost("/v1/pay", (FlagState live) => Results.Ok(new
{
    gateway = live.IsEnabled(Flag.UseBackupGateway, subject: null) ? "backup" : "primary"
}));

// DECISION 4: every evaluation can explain itself.
app.MapGet("/internal/flags/{subject}", (string subject, FlagState live) =>
    Results.Ok(FlagRegistry.All.Select(f => new
    {
        flag = f.Name,
        enabled = live.IsEnabled(f.Key, subject),
        why = live.Explain(f.Key, subject)
    })));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("One flag system, with every decision made");
Console.WriteLine();

// The registry, which is the whole point.
Console.WriteLine("   THE REGISTRY - in code, so it can be diffed, reviewed and tested");
Console.WriteLine();
Console.WriteLine($"   {"flag",-22} {"kind",-11} {"owner",-12} {"remove by",-12} status");
Console.WriteLine($"   {new string('-', 22)} {new string('-', 11)} {new string('-', 12)} {new string('-', 12)} ------");

var today = new DateOnly(2026, 9, 6);

foreach (FlagDefinition flag in FlagRegistry.All)
{
    string status = flag.RemoveBy is null
        ? "permanent"
        : flag.RemoveBy < today ? "OVERDUE" : "on time";

    Console.WriteLine($"   {flag.Name,-22} {flag.Kind,-11} {flag.Owner,-12} " +
        $"{flag.RemoveBy?.ToString("yyyy-MM-dd") ?? "-",-12} {status}");
}

// The test that keeps the registry honest.
List<FlagDefinition> overdue = [.. FlagRegistry.All
    .Where(f => f.Kind is FlagKind.Release or FlagKind.Experiment)
    .Where(f => f.RemoveBy is { } by && by < today)];

Console.WriteLine();
Console.WriteLine("   THE TEST THAT RUNS ON EVERY BUILD");
Console.WriteLine();
Console.WriteLine($"     overdue release and experiment flags   {overdue.Count}");
Console.WriteLine($"     the build would                        " +
    $"{(overdue.Count == 0 ? "pass" : "FAIL: " + string.Join(", ", overdue.Select(f => f.Name)))}");

// Evaluation, in order.
Console.WriteLine();
Console.WriteLine("   EVALUATION, FOR SIX SUBJECTS");
Console.WriteLine();
Console.WriteLine($"   {"subject",-16} {"NewCheckout",-13} why");
Console.WriteLine($"   {new string('-', 16)} {new string('-', 13)} ---");

foreach (string subject in new[]
{
    "user-00005", "user-00002", "staff-001", "tenant-014", "user-00042", "user-00099"
})
{
    Console.WriteLine($"   {subject,-16} " +
        $"{(state.IsEnabled(Flag.NewCheckout, subject) ? "on" : "off"),-13} " +
        $"{state.Explain(Flag.NewCheckout, subject)}");
}

// The snapshot holding steady while the flag moves.
Console.WriteLine();
Console.WriteLine("   THE PER-REQUEST SNAPSHOT");
Console.WriteLine();

state.SetRollout(Flag.NewCheckout, 0);
Console.WriteLine($"     rollout at 0%     {await http.GetStringAsync("/v1/checkout")}");

state.SetRollout(Flag.NewCheckout, 100);
Console.WriteLine($"     rollout at 100%   {await http.GetStringAsync("/v1/checkout")}");

// The ops toggle, read live.
Console.WriteLine();
Console.WriteLine("   THE OPS TOGGLE, READ LIVE");
Console.WriteLine();

state.SetRollout(Flag.UseBackupGateway, 0);
Console.WriteLine($"     before   {await Post(http, "/v1/pay")}");

state.SetRollout(Flag.UseBackupGateway, 100);
Console.WriteLine($"     after    {await Post(http, "/v1/pay")}   (no restart)");

// The endpoint that answers 'why did this customer get that'.
Console.WriteLine();
Console.WriteLine("   THE ENDPOINT THAT ANSWERS SUPPORT TICKETS");
Console.WriteLine();
Console.WriteLine($"     GET /internal/flags/tenant-014");

string explanation = await http.GetStringAsync("/internal/flags/tenant-014");

foreach (string line in explanation.Split("},").Select(l => l.Trim('[', ']', '{', '}')))
{
    Console.WriteLine($"       {line}");
}

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   WHAT EACH DECISION BOUGHT:");
Console.WriteLine();
Console.WriteLine("     THE REGISTRY IS IN CODE. It can be diffed in a pull request, reviewed");
Console.WriteLine("     next to the branch it guards, and read by a test. A flag that exists");
Console.WriteLine("     only in an external console cannot be any of those things, which is");
Console.WriteLine("     how a flag outlives the team that added it.");
Console.WriteLine();
Console.WriteLine("     EVERY RELEASE FLAG HAS A REMOVAL DATE AND A TEST ENFORCES IT. Not a");
Console.WriteLine("     convention and not a backlog item - a failing build. It is the only");
Console.WriteLine("     mechanism that survives a reorganisation, because the failure lands on");
Console.WriteLine("     whoever is working now rather than on whoever left.");
Console.WriteLine();
Console.WriteLine("     THE KEYS ARE TYPED. Flag.NewCheckout rather than a string, so a typo");
Console.WriteLine("     does not compile. Section 1 of the exercises is the failure this");
Console.WriteLine("     removes, and it removes it completely rather than making it rarer.");
Console.WriteLine();
Console.WriteLine("     EXCLUSIONS BEAT INCLUSIONS BEAT THE PERCENTAGE. A customer taken off a");
Console.WriteLine("     broken rollout stays off it at 100%, and a staff account can test a");
Console.WriteLine("     feature at 0%. Those two properties are what make a flag more useful");
Console.WriteLine("     than a deployment.");
Console.WriteLine();
Console.WriteLine("     THE HASH INCLUDES THE FLAG NAME, so two 50% rollouts are two different");
Console.WriteLine("     halves rather than the same half twice.");
Console.WriteLine();
Console.WriteLine("     RELEASE FLAGS ARE SNAPSHOTTED PER REQUEST AND OPS FLAGS ARE NOT. The");
Console.WriteLine("     scope follows the kind: consistency within a unit of work for one,");
Console.WriteLine("     immediate effect for the other. Neither is the house style.");
Console.WriteLine();
Console.WriteLine("     EVERY EVALUATION EXPLAINS ITSELF, on an endpoint. 'Why did this");
Console.WriteLine("     customer get the new checkout' becomes a lookup rather than an");
Console.WriteLine("     investigation, and it is the difference between minutes and an");
Console.WriteLine("     afternoon.");
Console.WriteLine();
Console.WriteLine("   AND THE THING THAT IS STILL NOT AUTOMATED: DELETING THE BRANCH. The test");
Console.WriteLine("   catches an overdue flag; a human still has to remove one of the two");
Console.WriteLine("   worlds. THE POINT OF REMOVING A FLAG IS THAT ONLY ONE PATH REMAINS - if");
Console.WriteLine("   both still compile, the cleanup has not happened, and the branch nobody");
Console.WriteLine("   runs will keep rotting whether or not a flag still points at it.");

// ---------------------------------------------------------------------------
static async Task<string> Post(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.PostAsync(path, null);

    return await response.Content.ReadAsStringAsync();
}

// ---------------------------------------------------------------------------
enum Flag
{
    NewCheckout,
    UseBackupGateway,
    PremiumReports
}

enum FlagKind
{
    Release,
    Experiment,
    Ops,
    Permission
}

// ---------------------------------------------------------------------------
record FlagDefinition(
    Flag Key,
    string Name,
    FlagKind Kind,
    string Owner,
    DateOnly? RemoveBy,
    string WhatHappensWhenItMoves);

// ---------------------------------------------------------------------------
// The registry. Everything a person needs in order to decide whether to touch
// a flag at 3am, in the repository rather than in a console.
static class FlagRegistry
{
    public static readonly FlagDefinition[] All =
    [
        new(Flag.NewCheckout, "NewCheckout", FlagKind.Release, "checkout",
            new DateOnly(2026, 11, 1),
            "On: the rewritten checkout. Off: the 2024 checkout. Both write the same ledger entries."),

        new(Flag.UseBackupGateway, "UseBackupGateway", FlagKind.Ops, "payments",
            null,
            "On: payments route to the backup provider, which does not support refunds. Safe to flip."),

        new(Flag.PremiumReports, "PremiumReports", FlagKind.Permission, "product",
            null,
            "On: advanced reporting. This is a pricing rule, not a rollout.")
    ];

    public static FlagDefinition Get(Flag key) => All.First(f => f.Key == key);
}

// ---------------------------------------------------------------------------
// The live state: rollout percentages plus the two override lists that sit
// above them.
sealed class FlagState
{
    readonly Dictionary<Flag, int> rollout = new()
    {
        [Flag.NewCheckout] = 10,
        [Flag.UseBackupGateway] = 0,
        [Flag.PremiumReports] = 0
    };

    readonly Dictionary<Flag, HashSet<string>> included = new()
    {
        [Flag.NewCheckout] = ["staff-001", "user-00042"]
    };

    readonly Dictionary<Flag, HashSet<string>> excluded = new()
    {
        [Flag.NewCheckout] = ["tenant-014", "user-00099"]
    };

    public void SetRollout(Flag key, int percent)
    {
        lock (rollout)
        {
            rollout[key] = percent;
        }
    }

    public bool IsEnabled(Flag key, string? subject) => Decide(key, subject).Enabled;

    public string Explain(Flag key, string? subject) => Decide(key, subject).Why;

    // The order is the design: exclusions, then inclusions, then the
    // percentage. Anything else makes an exclusion overridable.
    (bool Enabled, string Why) Decide(Flag key, string? subject)
    {
        if (subject is not null && excluded.TryGetValue(key, out HashSet<string>? off)
            && off.Contains(subject))
        {
            return (false, "excluded by list");
        }

        if (subject is not null && included.TryGetValue(key, out HashSet<string>? on)
            && on.Contains(subject))
        {
            return (true, "included by list");
        }

        int percent;

        lock (rollout)
        {
            percent = rollout[key];
        }

        // A flag with no subject - an ops toggle - is all-or-nothing, and
        // there is nothing to hash.
        if (subject is null)
        {
            return (percent >= 100, percent >= 100 ? "rollout at 100%" : $"rollout at {percent}%");
        }

        int bucket = Bucket(key, subject);

        return bucket < percent
            ? (true, $"bucket {bucket} < {percent}%")
            : (false, $"bucket {bucket} >= {percent}%");
    }

    // The flag name is part of the hash input, so two rollouts at the same
    // percentage pick two different halves.
    static int Bucket(Flag key, string subject)
    {
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{key}:{subject}"));

        return (int)(BitConverter.ToUInt32(hash, 0) % 100);
    }
}

// ---------------------------------------------------------------------------
// One reading of the release flags, taken when the request scope is created.
// Every read within the request agrees, whatever happens to the flag meanwhile.
sealed class FlagSnapshot(FlagState state, IHttpContextAccessor accessor)
{
    readonly Dictionary<Flag, bool> values = FlagRegistry.All
        .Where(f => f.Kind is FlagKind.Release or FlagKind.Experiment)
        .ToDictionary(
            f => f.Key,
            f => state.IsEnabled(f.Key, accessor.HttpContext?.Request.Headers["X-Subject"].ToString()));

    public bool IsEnabled(Flag key) => values.TryGetValue(key, out bool value) && value;
}
