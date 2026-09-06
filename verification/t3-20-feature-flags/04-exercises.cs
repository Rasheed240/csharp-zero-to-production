// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every value and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Security.Cryptography;
using System.Text;

One();
await Two();
Three();
Four();

// ---------------------------------------------------------------------------
static void One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the flag that works locally and not in production");
    Console.WriteLine();
    Console.WriteLine("   A flag is read with configuration.GetValue<bool>(\"Features:NewCheckout\").");
    Console.WriteLine("   It works on every developer machine, where it is set in");
    Console.WriteLine("   appsettings.Development.json. In production, where it is set by");
    Console.WriteLine("   environment variable, it is never on.");
    Console.WriteLine();
    Console.WriteLine("   Both places set it to true. What is different?");
    Console.WriteLine();

    (string Key, string Value, bool AsEnvironment, string Where)[] attempts =
    [
        ("Features:NewCheckout", "true", false, "appsettings, colon separator"),
        ("Features__NewCheckout", "true", true, "environment variable, double underscore"),
        ("Features_NewCheckout", "true", true, "environment variable, single underscore"),
        ("FEATURES__NEWCHECKOUT", "true", true, "environment variable, uppercase"),
        ("Features:NewCheckout", "True", false, "value with a capital T"),
        ("Features:NewCheckout", "1", false, "value as 1"),
        ("Features:NewCheckout", "yes", false, "value as yes"),
        ("Features:NewCheckout", "on", false, "value as on")
    ];

    Console.WriteLine("   how it was set                             GetValue<bool> returns");
    Console.WriteLine("   --------------                             ----------------------");

    foreach ((string key, string value, bool asEnvironment, string where) in attempts)
    {
        string result;

        try
        {
            // The environment rows go through the real environment provider,
            // because the double-underscore mapping is that provider's rule -
            // not something configuration does to every key.
            if (asEnvironment)
            {
                Environment.SetEnvironmentVariable(key, value);
            }

            IConfiguration configuration = asEnvironment
                ? new ConfigurationBuilder().AddEnvironmentVariables().Build()
                : new ConfigurationBuilder()
                    .AddInMemoryCollection(new Dictionary<string, string?> { [key] = value })
                    .Build();

            result = configuration.GetValue<bool>("Features:NewCheckout").ToString();
        }
        catch (Exception exception)
        {
            result = exception.GetType().Name;
        }
        finally
        {
            if (asEnvironment)
            {
                Environment.SetEnvironmentVariable(key, null);
            }
        }

        Console.WriteLine($"   {where,-42} {result}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THERE ARE TWO SEPARATE TRAPS IN THAT TABLE and the exercise");
    Console.WriteLine("   contains both.");
    Console.WriteLine();
    Console.WriteLine("     THE SEPARATOR. Environment variables cannot contain a colon on every");
    Console.WriteLine("     platform, so configuration maps a DOUBLE UNDERSCORE onto the colon.");
    Console.WriteLine("     A single underscore is not a separator - it produces a key called");
    Console.WriteLine("     'Features_NewCheckout', which nothing reads. Case does not matter;");
    Console.WriteLine("     the number of underscores does.");
    Console.WriteLine();
    Console.WriteLine("     THE VALUE. 'true' and 'True' both bind, case-insensitively. '1',");
    Console.WriteLine("     'yes' and 'on' all THROW - which is the better failure, because it");
    Console.WriteLine("     is loud, and it is still the wrong place for it: the exception");
    Console.WriteLine("     surfaces at the read, inside a handler, on the first request that");
    Console.WriteLine("     reaches that line. Not at startup, where a bad value belongs.");
    Console.WriteLine();
    Console.WriteLine("   THE SEPARATOR FAILURE IS THE DANGEROUS ONE, because it is silent and");
    Console.WriteLine("   LOOKS IDENTICAL TO 'THE FLAG IS DELIBERATELY OFF'. Nobody investigates");
    Console.WriteLine("   a feature not appearing when the flag for it is supposed to be off.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS TO STOP USING RAW STRINGS AT THE CALL SITE. One typed");
    Console.WriteLine("   accessor, with the key written once, turns a silent false into a");
    Console.WriteLine("   compile error - and gives you a place to log every flag's resolved");
    Console.WriteLine("   value at startup, which answers this question in one line of output.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the kill switch that would not kill");
    Console.WriteLine();
    Console.WriteLine("   A payment gateway starts failing. The team has a kill switch that");
    Console.WriteLine("   routes payments to a backup provider. On-call flips it and watches the");
    Console.WriteLine("   error rate. Nothing changes for eleven minutes, until somebody");
    Console.WriteLine("   restarts the service.");
    Console.WriteLine();
    Console.WriteLine("   The flag value was correct in the console the whole time. Why did");
    Console.WriteLine("   nothing happen?");
    Console.WriteLine();

    var flags = new MutableFlags();
    flags.Set("UseBackupGateway", false);

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton(flags);

    // The registration everybody writes, because it looks tidy: resolve the
    // value once and hand the right implementation to whoever needs it.
    builder.Services.AddSingleton<IGateway>(_ => flags.Get("UseBackupGateway")
        ? new BackupGateway()
        : new PrimaryGateway());

    // The version that reads the flag when the decision is made.
    builder.Services.AddSingleton<GatewayChooser>();

    var app = builder.Build();

    app.MapPost("/pay-injected", (IGateway gateway) => Results.Ok(new { via = gateway.Name }));
    app.MapPost("/pay-chosen", (GatewayChooser chooser) => Results.Ok(new { via = chooser.Choose().Name }));

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   moment                        resolved at startup   chosen per request");
    Console.WriteLine("   ------                        -------------------   ------------------");
    Console.WriteLine($"   before the incident           {await Via(http, "/pay-injected"),-21} {await Via(http, "/pay-chosen")}");

    flags.Set("UseBackupGateway", true);

    Console.WriteLine($"   after flipping the switch     {await Via(http, "/pay-injected"),-21} {await Via(http, "/pay-chosen")}");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE FLAG WAS READ ONCE, AT STARTUP, TO CHOOSE WHICH OBJECT TO");
    Console.WriteLine("   REGISTER. After that the container holds a PrimaryGateway and no");
    Console.WriteLine("   amount of flipping changes which object it holds. The eleven minutes");
    Console.WriteLine("   ended when the restart re-ran the factory.");
    Console.WriteLine();
    Console.WriteLine("   THE REGISTRATION LOOKS LIKE GOOD DESIGN, which is why it survives");
    Console.WriteLine("   review: the flag is read in one place, the rest of the code depends on");
    Console.WriteLine("   an interface, and nothing downstream knows a flag exists. Every one of");
    Console.WriteLine("   those is a virtue in other contexts.");
    Console.WriteLine();
    Console.WriteLine("   WHAT IT COSTS IS THE ONLY PROPERTY THAT MATTERED: A KILL SWITCH EXISTS");
    Console.WriteLine("   TO BE USED DURING AN INCIDENT, WHICH IS EXACTLY WHEN RESTARTING IS THE");
    Console.WriteLine("   THING YOU DO NOT WANT TO DO. A flag that requires a restart is a");
    Console.WriteLine("   configuration setting; calling it a kill switch is the bug.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL RULE: THE FLAG MUST BE READ AT THE POINT THE DECISION IS");
    Console.WriteLine("   MADE, not at the point the object is built. Inject something that can");
    Console.WriteLine("   choose, rather than the result of a choice made at startup.");
    Console.WriteLine();
    Console.WriteLine("   AND THIS IS IN TENSION WITH THE PREVIOUS FILE'S ADVICE TO SNAPSHOT PER");
    Console.WriteLine("   REQUEST, DELIBERATELY. Per-request is the right scope for a release");
    Console.WriteLine("   toggle, where consistency within a unit of work matters more than");
    Console.WriteLine("   latency. An ops toggle wants the newest value it can get. THE SCOPE IS");
    Console.WriteLine("   A PROPERTY OF THE FLAG'S KIND, and 'always snapshot' is as wrong as");
    Console.WriteLine("   'never snapshot'.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Three()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the experiment that only worked for some users");
    Console.WriteLine();
    Console.WriteLine("   A 50% experiment on a new landing page. The results are clean for");
    Console.WriteLine("   signed-in users. For signed-out visitors, 100% of them are in the");
    Console.WriteLine("   control group - the variant never shows.");
    Console.WriteLine();
    Console.WriteLine("   The targeting code is one line and has no branch in it. What is");
    Console.WriteLine("   happening?");
    Console.WriteLine();

    // Signed-in visitors have an id. Signed-out ones do not, and the code
    // passes whatever it has.
    string?[] visitors =
    [
        .. Enumerable.Range(1, 500).Select(n => (string?)$"user-{n:0000}"),
        .. Enumerable.Repeat((string?)null, 500)
    ];

    int signedInEnabled = visitors.Take(500).Count(v => InBucket(v, "NewLanding", 50));
    int signedOutEnabled = visitors.Skip(500).Count(v => InBucket(v, "NewLanding", 50));

    Console.WriteLine("   group                 visitors   in the variant   share");
    Console.WriteLine("   -----                 --------   --------------   -----");
    Console.WriteLine($"   signed in                  500   {signedInEnabled,14}   {signedInEnabled / 5.0,4:0.0}%");
    Console.WriteLine($"   signed out                 500   {signedOutEnabled,14}   {signedOutEnabled / 5.0,4:0.0}%");

    Console.WriteLine();
    Console.WriteLine($"   the bucket every signed-out visitor lands in   {Bucket(null, "NewLanding")}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: EVERY SIGNED-OUT VISITOR HAS THE SAME TARGETING KEY - the");
    Console.WriteLine("   empty one - so they all hash to the same bucket and all receive the");
    Console.WriteLine("   same answer. Whether that answer is 'variant' or 'control' is decided");
    Console.WriteLine("   by one hash of one string, and here it happens to be control.");
    Console.WriteLine();
    Console.WriteLine("   THERE IS NO BRANCH IN THE CODE BECAUSE THE CODE IS CORRECT. A hash of");
    Console.WriteLine("   a constant is a constant. The defect is that half the population has no");
    Console.WriteLine("   identity, and nobody noticed because the experiment was designed");
    Console.WriteLine("   thinking about users rather than about visitors.");
    Console.WriteLine();
    Console.WriteLine("   IT COULD HAVE BEEN WORSE IN A QUIETER WAY. If that bucket had landed");
    Console.WriteLine("   under 50, every signed-out visitor would have got the variant, the");
    Console.WriteLine("   overall split would still have looked like 50%, and the experiment");
    Console.WriteLine("   would have compared 'signed-in half' against 'signed-in half plus all");
    Console.WriteLine("   the anonymous traffic'. THE SAME BUG, PRODUCING A CONFIDENT AND");
    Console.WriteLine("   COMPLETELY WRONG RESULT rather than an obvious one.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS A TARGETING KEY THAT ALWAYS EXISTS: a session id or a");
    Console.WriteLine("   first-party cookie set on first visit, falling back to the user id");
    Console.WriteLine("   once they sign in. Which raises the question that key changes always");
    Console.WriteLine("   raise - A VISITOR WHO SIGNS IN MID-SESSION CHANGES BUCKET, so decide");
    Console.WriteLine("   deliberately whether that is acceptable for this experiment.");
    Console.WriteLine();
    Console.WriteLine("   AND THE CHECK THAT FINDS THIS CLASS OF BUG IN SECONDS: COUNT THE");
    Console.WriteLine("   DISTINCT TARGETING KEYS. If it is much smaller than your visitor count,");
    Console.WriteLine("   some population is sharing a key, and every one of them is getting the");
    Console.WriteLine("   same answer.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the cleanup that broke three customers");
    Console.WriteLine();
    Console.WriteLine("   A rollout reaches 100%. The team does the right thing: deletes the");
    Console.WriteLine("   flag, deletes the old branch, ships the cleanup. Three enterprise");
    Console.WriteLine("   customers immediately report that a feature they had switched off is");
    Console.WriteLine("   back.");
    Console.WriteLine();
    Console.WriteLine("   The rollout really was at 100%. How were those three not already on");
    Console.WriteLine("   it?");
    Console.WriteLine();

    string[] tenants = [.. Enumerable.Range(1, 200).Select(n => $"tenant-{n:000}")];

    // Three customers asked to be taken off during the rollout, after a bug.
    string[] excluded = ["tenant-014", "tenant-088", "tenant-137"];

    int atFullRollout = tenants.Count(t => Evaluate(t, "NewReports", 100, excluded));
    int afterRemoval = tenants.Length;

    Console.WriteLine("   state                                    tenants with the feature");
    Console.WriteLine("   -----                                    ------------------------");
    Console.WriteLine($"   flag at 100%, exclusions in place        {atFullRollout} of {tenants.Length}");
    Console.WriteLine($"   flag deleted, branch removed             {afterRemoval} of {tenants.Length}");
    Console.WriteLine();
    Console.WriteLine($"   tenants whose behaviour changed at cleanup   {afterRemoval - atFullRollout}");
    Console.WriteLine($"   which ones                                   {string.Join(", ", excluded)}");

    Console.WriteLine();
    Console.WriteLine("   ANSWER: '100%' WAS NEVER 'EVERYONE'. The percentage is the last rule in");
    Console.WriteLine("   the evaluation, and the exclusion list sits above it - which is exactly");
    Console.WriteLine("   the design you want, because an exclusion a later rule can override is");
    Console.WriteLine("   not an exclusion. So '100%' means 'everyone the earlier rules did not");
    Console.WriteLine("   already decide'.");
    Console.WriteLine();
    Console.WriteLine("   THE DASHBOARD SAID 100% AND THE DASHBOARD WAS RIGHT. It was reporting");
    Console.WriteLine("   the rollout percentage, which is an input to the evaluation, not the");
    Console.WriteLine("   proportion of tenants for whom the flag evaluates true - which is an");
    Console.WriteLine("   output. Those two numbers differ by exactly the size of your override");
    Console.WriteLine("   lists, and almost every flag console shows the first one.");
    Console.WriteLine();
    Console.WriteLine("   SO REMOVING A FLAG IS NOT ALWAYS A NO-OP, AND THE TEST IS SPECIFIC:");
    Console.WriteLine("   DOES ANY OVERRIDE STILL EXIST? If the answer is yes, deleting the flag");
    Console.WriteLine("   changes behaviour for exactly those subjects, and each one is a");
    Console.WriteLine("   customer with a reason - usually a reason recorded in a support ticket");
    Console.WriteLine("   nobody involved in the cleanup has read.");
    Console.WriteLine();
    Console.WriteLine("   WHAT TO DO INSTEAD, IN ORDER:");
    Console.WriteLine();
    Console.WriteLine("     1. CLEAR THE OVERRIDES FIRST, as a separate change. Every removal is");
    Console.WriteLine("        a decision about one customer, and each one either gets migrated");
    Console.WriteLine("        or gets a real product setting.");
    Console.WriteLine();
    Console.WriteLine("     2. WAIT, with the flag still at 100% and no overrides. If nothing");
    Console.WriteLine("        comes back, the rollout genuinely is complete.");
    Console.WriteLine();
    Console.WriteLine("     3. THEN delete the flag and the branch, which is now provably a");
    Console.WriteLine("        no-op.");
    Console.WriteLine();
    Console.WriteLine("   AND THE DEEPER LESSON IS ABOUT WHAT THE OVERRIDES WERE DOING. Three");
    Console.WriteLine("   customers had a durable preference recorded in a temporary mechanism.");
    Console.WriteLine("   A RELEASE TOGGLE'S OVERRIDE LIST IS NOT A PLACE TO STORE CUSTOMER");
    Console.WriteLine("   PREFERENCES - the moment a preference needs to outlive the rollout, it");
    Console.WriteLine("   is a product feature and belongs in the product.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static bool Evaluate(string subject, string flag, int percent, string[] excluded) =>
    !excluded.Contains(subject) && InBucket(subject, flag, percent);

// ---------------------------------------------------------------------------
static int Bucket(string? subject, string flag)
{
    byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{flag}:{subject ?? ""}"));

    return (int)(BitConverter.ToUInt32(hash, 0) % 100);
}

// ---------------------------------------------------------------------------
static bool InBucket(string? subject, string flag, int percent) => Bucket(subject, flag) < percent;

// ---------------------------------------------------------------------------
static async Task<string> Via(HttpClient http, string path)
{
    using HttpResponseMessage response = await http.PostAsync(path, null);
    string body = await response.Content.ReadAsStringAsync();

    return body.Contains("Backup") ? "backup" : "primary";
}

// ---------------------------------------------------------------------------
interface IGateway
{
    string Name { get; }
}

sealed class PrimaryGateway : IGateway
{
    public string Name => "Primary";
}

sealed class BackupGateway : IGateway
{
    public string Name => "Backup";
}

// ---------------------------------------------------------------------------
// Reads the flag when the decision is made rather than when the container is
// built, which is the only difference that matters.
sealed class GatewayChooser(MutableFlags flags)
{
    public IGateway Choose() => flags.Get("UseBackupGateway")
        ? new BackupGateway()
        : new PrimaryGateway();
}

// ---------------------------------------------------------------------------
sealed class MutableFlags
{
    readonly Dictionary<string, bool> values = [];

    public bool Get(string name)
    {
        lock (values)
        {
            return values.TryGetValue(name, out bool value) && value;
        }
    }

    public void Set(string name, bool value)
    {
        lock (values)
        {
            values[name] = value;
        }
    }
}
