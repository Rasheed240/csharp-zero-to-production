// 03-production.cs — The incident: a variable that was definitely set, and an
// application that definitely ignored it.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every value and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Configuration;

TheIncident();
WhatItLookedLike();
TheFix();
Checklist();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. The incident");
    Console.WriteLine();
    Console.WriteLine("   Ledger moves its payment gateway to a new endpoint. The base URL lives");
    Console.WriteLine("   in configuration, so this is a deployment change rather than a code");
    Console.WriteLine("   change - which is the entire reason it is in configuration.");
    Console.WriteLine();
    Console.WriteLine("   The manifest sets it:");
    Console.WriteLine();
    Console.WriteLine("     env:");
    Console.WriteLine("       - name: Gateway_BaseUrl");
    Console.WriteLine("         value: https://gw-v2.internal:8443");
    Console.WriteLine();
    Console.WriteLine("   The change is reviewed, merged and rolled out. Payments keep working,");
    Console.WriteLine("   because the old endpoint has not been switched off yet.");
    Console.WriteLine();
    Console.WriteLine("   Eleven days later the old endpoint is switched off, and every payment");
    Console.WriteLine("   in the estate fails at once.");
    Console.WriteLine();

    Console.WriteLine("   variable set in the manifest   application resolves BaseUrl to");
    Console.WriteLine("   ----------------------------   -------------------------------");

    foreach (string name in new[] { "Gateway_BaseUrl", "Gateway__BaseUrl" })
    {
        Environment.SetEnvironmentVariable(name, "https://gw-v2.internal:8443");

        IConfigurationRoot configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                // The committed default, from appsettings.json.
                ["Gateway:BaseUrl"] = "https://gw-v1.internal:8443"
            })
            .AddEnvironmentVariables()
            .Build();

        Console.WriteLine($"   {name,-28}   {configuration["Gateway:BaseUrl"]}");

        Environment.SetEnvironmentVariable(name, null);
    }

    Console.WriteLine();
    Console.WriteLine("   ONE UNDERSCORE. A single underscore is part of the key name; a double");
    Console.WriteLine("   underscore is the separator between levels. So the manifest defined a");
    Console.WriteLine("   top-level key called 'Gateway_BaseUrl' that nothing reads, and the");
    Console.WriteLine("   application went on using the committed default.");
    Console.WriteLine();
    Console.WriteLine("   NOTHING ANYWHERE WAS WRONG IN A WAY ANY CHECK COULD SEE:");
    Console.WriteLine();
    Console.WriteLine("     - the variable was set, and 'printenv' showed it;");
    Console.WriteLine("     - the manifest was reviewed and the value in it was correct;");
    Console.WriteLine("     - the application started and passed every health check;");
    Console.WriteLine("     - payments worked, because the old endpoint still answered.");
    Console.WriteLine();
    Console.WriteLine("   The change appeared to succeed for eleven days. THE FAILURE WAS");
    Console.WriteLine("   SCHEDULED FOR WHENEVER SOMEBODY ELSE TURNED OFF THE OLD ENDPOINT,");
    Console.WriteLine("   which is the worst possible separation between cause and effect.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatItLookedLike()
{
    Console.WriteLine("2. Why every instinct pointed the wrong way");
    Console.WriteLine();
    Console.WriteLine("   The first question in the incident channel was 'did the config change");
    Console.WriteLine("   deploy?', and the answer was yes, eleven days ago, and here is the");
    Console.WriteLine("   variable in the running pod.");
    Console.WriteLine();
    Console.WriteLine("   That answer is TRUE AND USELESS, and it closed off the correct line of");
    Console.WriteLine("   enquiry for two hours. What nobody asked was the different question:");
    Console.WriteLine();
    Console.WriteLine("     not 'is the variable set'");
    Console.WriteLine("     but 'WHAT VALUE DOES THE APPLICATION HAVE'");
    Console.WriteLine();
    Console.WriteLine("   Those are different questions, and only the second one matters. The");
    Console.WriteLine("   application could not answer it, because nothing logged it.");
    Console.WriteLine();
    Console.WriteLine("   THE SAME GAP PRODUCES A WHOLE FAMILY OF INCIDENTS, all of which look");
    Console.WriteLine("   different from outside and are the same thing:");
    Console.WriteLine();
    Console.WriteLine("     - a single underscore instead of a double one;");
    Console.WriteLine("     - a colon in a Linux environment variable, which is not a legal");
    Console.WriteLine("       name and so is silently dropped;");
    Console.WriteLine("     - a key set in appsettings.Staging.json while the pod runs as");
    Console.WriteLine("       'staging', which does not match - environment names are");
    Console.WriteLine("       case-sensitive in the file name;");
    Console.WriteLine("     - a section renamed in code and not in the file, so binding matches");
    Console.WriteLine("       nothing and every property takes its default;");
    Console.WriteLine("     - a secret store that failed to load and was registered optional, so");
    Console.WriteLine("       startup succeeded with no secrets at all.");
    Console.WriteLine();
    Console.WriteLine("   EVERY ONE OF THESE IS SILENT, and every one is caught by the same");
    Console.WriteLine("   thing.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheFix()
{
    Console.WriteLine("3. The fix, which is nine lines");
    Console.WriteLine();
    Console.WriteLine("   Log the resolved configuration at startup, with anything sensitive");
    Console.WriteLine("   redacted, and fail if a required value is absent.");
    Console.WriteLine();
    Console.WriteLine("   LOG YOUR OWN SECTIONS, NOT EVERYTHING. The environment variables");
    Console.WriteLine("   provider contributes every variable the process has, so dumping all of");
    Console.WriteLine("   configuration prints several hundred lines of machine environment and");
    Console.WriteLine("   puts whatever is in it into your log store. Filter to the prefixes");
    Console.WriteLine("   your application owns - here, 'Gateway'.");
    Console.WriteLine();

    // Wrong: the value nobody set.
    Environment.SetEnvironmentVariable("Gateway_BaseUrl", "https://gw-v2.internal:8443");

    IConfigurationRoot broken = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:BaseUrl"] = "https://gw-v1.internal:8443",
            ["Gateway:ApiKey"] = "sk-live-abcdef123456"
        })
        .AddEnvironmentVariables()
        .Build();

    Console.WriteLine("   what the startup log would have said on the day of the deploy:");
    Console.WriteLine();

    LogResolved(broken, "Gateway");

    Console.WriteLine();
    Console.WriteLine("   THREE WORDS WOULD HAVE ENDED IT: 'gw-v1' in a log line, on the day of");
    Console.WriteLine("   the deploy, next to a change whose whole purpose was to make it say");
    Console.WriteLine("   'gw-v2'.");
    Console.WriteLine();

    Environment.SetEnvironmentVariable("Gateway_BaseUrl", null);
    Environment.SetEnvironmentVariable("Gateway__BaseUrl", "https://gw-v2.internal:8443");

    IConfigurationRoot fixedUp = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:BaseUrl"] = "https://gw-v1.internal:8443",
            ["Gateway:ApiKey"] = "sk-live-abcdef123456"
        })
        .AddEnvironmentVariables()
        .Build();

    Console.WriteLine("   and with the correct variable name:");
    Console.WriteLine();

    LogResolved(fixedUp, "Gateway");

    Environment.SetEnvironmentVariable("Gateway__BaseUrl", null);

    Console.WriteLine();
    Console.WriteLine("   NOTE THE PROVIDER COLUMN, which is the part worth stealing. Knowing");
    Console.WriteLine("   the value is half the answer; knowing WHICH SOURCE SUPPLIED IT is the");
    Console.WriteLine("   other half, and it turns 'the variable is ignored' from a hypothesis");
    Console.WriteLine("   into a line of output.");
    Console.WriteLine();
    Console.WriteLine("   IConfigurationRoot.GetDebugView() produces the same thing built in,");
    Console.WriteLine("   and takes the redaction function that makes it safe to log:");
    Console.WriteLine();
    Console.WriteLine("     var root = (IConfigurationRoot)builder.Configuration;");
    Console.WriteLine();
    Console.WriteLine("     logger.LogInformation(\"Resolved configuration:\\n{Configuration}\",");
    Console.WriteLine("         root.GetDebugView(context =>");
    Console.WriteLine("             Sensitive(context.Key) ? \"***\" : context.Value));");
    Console.WriteLine();
    Console.WriteLine("   It prints the whole tree, so pair it with the same filtering - or");
    Console.WriteLine("   call it on GetSection(\"Gateway\") rather than on the root.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Checklist()
{
    Console.WriteLine("4. What to do about this class of bug");
    Console.WriteLine();
    Console.WriteLine("   1. LOG THE RESOLVED CONFIGURATION AT STARTUP, with secrets redacted");
    Console.WriteLine("      and the source of each value named. It is the only artefact that");
    Console.WriteLine("      answers 'what does the application think' rather than 'what did we");
    Console.WriteLine("      intend'.");
    Console.WriteLine();
    Console.WriteLine("   2. FAIL AT STARTUP ON A MISSING REQUIRED VALUE. A base URL with no");
    Console.WriteLine("      sensible default should stop the process, not fall back to a");
    Console.WriteLine("      committed one. That is the next module's subject and it is the");
    Console.WriteLine("      strongest fix here.");
    Console.WriteLine();
    Console.WriteLine("   3. DO NOT COMMIT A WORKING DEFAULT FOR A VALUE THAT MUST BE SET PER");
    Console.WriteLine("      ENVIRONMENT. The reason this survived eleven days is that the");
    Console.WriteLine("      fallback worked. A default that cannot work - or no default at all -");
    Console.WriteLine("      fails immediately and locally.");
    Console.WriteLine();
    Console.WriteLine("   4. USE DOUBLE UNDERSCORES, and grep the manifests for single ones. It");
    Console.WriteLine("      is one search and it finds every instance of this in a repository.");
    Console.WriteLine();
    Console.WriteLine("   5. MAKE THE SMOKE TEST READ THE VALUE BACK. An endpoint that returns");
    Console.WriteLine("      the non-secret parts of the resolved configuration turns 'is it");
    Console.WriteLine("      deployed' into a question a script can answer.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL LESSON is not about underscores. It is that CONFIGURATION");
    Console.WriteLine("   FAILS SILENTLY BY DESIGN: an unrecognised key is not an error, a");
    Console.WriteLine("   missing key is not an error, and a value from the wrong source is");
    Console.WriteLine("   indistinguishable from the right one. Everything above is a way of");
    Console.WriteLine("   making one of those loud.");
}

// ---------------------------------------------------------------------------
// The nine lines. Prints every key, its value, and which provider supplied it.
static void LogResolved(IConfigurationRoot configuration, string prefix)
{
    IEnumerable<KeyValuePair<string, string?>> matching = configuration.AsEnumerable()
        .Where(pair => pair.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        .OrderBy(pair => pair.Key);

    foreach ((string key, string? _) in matching)
    {
        string? value = configuration[key];

        if (value is null)
        {
            continue;
        }

        string shown = IsSensitive(key) ? "***" : value;
        string provider = SourceOf(configuration, key);

        Console.WriteLine($"     {key,-24}  {shown,-34}  {provider}");
    }

    static bool IsSensitive(string key) =>
        key.Contains("key", StringComparison.OrdinalIgnoreCase)
        || key.Contains("secret", StringComparison.OrdinalIgnoreCase)
        || key.Contains("password", StringComparison.OrdinalIgnoreCase)
        || key.Contains("token", StringComparison.OrdinalIgnoreCase);

    // The last provider that has the key is the one that answered.
    static string SourceOf(IConfigurationRoot configuration, string key)
    {
        foreach (IConfigurationProvider provider in configuration.Providers.Reverse())
        {
            if (provider.TryGet(key, out _))
            {
                return provider.GetType().Name.Replace("ConfigurationProvider", "");
            }
        }

        return "(none)";
    }
}
