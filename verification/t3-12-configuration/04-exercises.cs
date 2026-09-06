// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every value and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Configuration;

One();
Two();
Three();
Four();

// ---------------------------------------------------------------------------
static void One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the timeout that became zero");
    Console.WriteLine();
    Console.WriteLine("   A service starts failing every gateway call instantly rather than");
    Console.WriteLine("   after five seconds. Nothing in the code changed. The file was renamed");
    Console.WriteLine("   from TimeoutSeconds to TimeoutInSeconds during a tidy-up, and the");
    Console.WriteLine("   options class was not.");
    Console.WriteLine();
    Console.WriteLine("   What does the application see, and why was there no error?");
    Console.WriteLine();

    Console.WriteLine("   the file says                bound object");
    Console.WriteLine("   -------------                ------------");

    foreach ((string label, string json) in new[]
    {
        ("TimeoutSeconds: 5", """{ "Gateway": { "BaseUrl": "https://a", "TimeoutSeconds": 5 } }"""),
        ("TimeoutInSeconds: 5", """{ "Gateway": { "BaseUrl": "https://a", "TimeoutInSeconds": 5 } }""")
    })
    {
        GatewayOptions? bound = Build(json).GetSection("Gateway").Get<GatewayOptions>();

        Console.WriteLine($"   {label,-27}  {bound}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: TimeoutSeconds has no matching key, so it keeps the value the");
    Console.WriteLine("   class gave it - and an int with no initialiser is 0. TimeoutInSeconds");
    Console.WriteLine("   has no matching property, so it is ignored.");
    Console.WriteLine();
    Console.WriteLine("   Both halves are silent because binding is a best-effort match. From");
    Console.WriteLine("   its point of view a key it does not recognise and a property nobody");
    Console.WriteLine("   set are both ordinary.");
    Console.WriteLine();
    Console.WriteLine("   WHY 'INSTANTLY' RATHER THAN 'NEVER': a zero timeout is a valid number,");
    Console.WriteLine("   so nothing downstream objected either. Every layer behaved correctly");
    Console.WriteLine("   on a value that was never intended to exist.");
    Console.WriteLine();
    Console.WriteLine("   THE CHEAPEST DEFENCE is a default in the class:");
    Console.WriteLine();
    Console.WriteLine("     public int TimeoutSeconds { get; set; } = 30;");
    Console.WriteLine();
    Console.WriteLine("   That converts a broken service into a working one with the wrong");
    Console.WriteLine("   timeout, which is a much better failure. The real fix is validation at");
    Console.WriteLine("   startup, in the next module.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the variable that works locally");
    Console.WriteLine();
    Console.WriteLine("   A developer sets Gateway:BaseUrl as an environment variable on Windows");
    Console.WriteLine("   and it works. The same name in the Linux deployment manifest does");
    Console.WriteLine("   nothing.");
    Console.WriteLine();
    Console.WriteLine("   Explain both halves, and give the name that works in both places.");
    Console.WriteLine();

    Console.WriteLine("   variable name        resolves Gateway:BaseUrl to");
    Console.WriteLine("   -------------        ---------------------------");

    foreach (string name in new[] { "Gateway:BaseUrl", "Gateway__BaseUrl", "Gateway_BaseUrl" })
    {
        Environment.SetEnvironmentVariable(name, "https://set.example");

        IConfigurationRoot configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Gateway:BaseUrl"] = "https://committed-default.example"
            })
            .AddEnvironmentVariables()
            .Build();

        Console.WriteLine($"   {name,-19}  {configuration["Gateway:BaseUrl"]}");

        Environment.SetEnvironmentVariable(name, null);
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: the colon form works here because this is Windows, where a");
    Console.WriteLine("   colon is a legal character in an environment variable name. On Linux");
    Console.WriteLine("   it is not, so the variable cannot exist and the manifest sets nothing.");
    Console.WriteLine();
    Console.WriteLine("   Gateway__BaseUrl is the answer. Double underscore is translated to the");
    Console.WriteLine("   colon separator by the environment variables provider, so it works on");
    Console.WriteLine("   every platform.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW IS THE TRAP THIS EXERCISE IS REALLY ABOUT. A single");
    Console.WriteLine("   underscore is legal everywhere and means nothing to the provider - it");
    Console.WriteLine("   defines a top-level key called 'Gateway_BaseUrl'. It cannot fail, so");
    Console.WriteLine("   it cannot warn.");
    Console.WriteLine();
    Console.WriteLine("   WHY THIS SHAPE OF BUG IS SO EXPENSIVE: it works on the machine of the");
    Console.WriteLine("   person who wrote it, which is the strongest possible evidence that it");
    Console.WriteLine("   is correct, and it is exactly the wrong evidence.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Three()
{
    Console.WriteLine("EXERCISE 3 (medium) - the allow-list that allowed too much");
    Console.WriteLine();
    Console.WriteLine("   appsettings.json lists three CORS origins for development.");
    Console.WriteLine("   appsettings.Production.json lists one, the production front end.");
    Console.WriteLine("   Production accepts requests from all three.");
    Console.WriteLine();
    Console.WriteLine("   Why, and what would you change?");
    Console.WriteLine();

    IConfigurationRoot merged = new ConfigurationBuilder()
        .AddInMemoryCollection(Flatten("""
        { "Cors": { "AllowedOrigins": [ "https://localhost:5173", "https://dev.ledger.example",
                                        "https://staging.ledger.example" ] } }
        """))
        .AddInMemoryCollection(Flatten("""
        { "Cors": { "AllowedOrigins": [ "https://app.ledger.example" ] } }
        """))
        .Build();

    Console.WriteLine("   what production actually allows:");
    Console.WriteLine();

    foreach (IConfigurationSection child in merged.GetSection("Cors:AllowedOrigins").GetChildren())
    {
        Console.WriteLine($"     [{child.Key}]  {child.Value}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: an array is stored as keys named 0, 1, 2. The production file");
    Console.WriteLine("   has a key named 0 and no others, so it overwrote element 0 and left");
    Console.WriteLine("   elements 1 and 2 exactly as the base file set them.");
    Console.WriteLine();
    Console.WriteLine("   Production is accepting requests from a developer's laptop origin and");
    Console.WriteLine("   from staging, and the file that was supposed to restrict it reads");
    Console.WriteLine("   correctly.");
    Console.WriteLine();
    Console.WriteLine("   THE SAME KEY-BY-KEY MERGE THAT MAKES OVERRIDES USEFUL FOR SCALARS");
    Console.WriteLine("   MAKES THEM DANGEROUS FOR LISTS. Nothing special is happening; arrays");
    Console.WriteLine("   are simply not a unit that configuration knows about.");
    Console.WriteLine();
    Console.WriteLine("   WHAT TO CHANGE, in order:");
    Console.WriteLine();
    Console.WriteLine("     1. Move the list out of the base file entirely, so each environment");
    Console.WriteLine("        file owns the whole list and there is nothing to merge with.");
    Console.WriteLine();
    Console.WriteLine("     2. Or make it one key: a delimited string that later sources replace");
    Console.WriteLine("        wholesale, split in the options class.");
    Console.WriteLine();
    Console.WriteLine("     3. Either way, log the resolved list at startup. For an allow-list");
    Console.WriteLine("        that log line is a security control, not a diagnostic.");
    Console.WriteLine();
    Console.WriteLine("   AND NOTE WHAT DOES NOT WORK: setting elements 1 and 2 to null in the");
    Console.WriteLine("   production file. That does not shorten the list, it puts nulls in it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - two environments, one file, no duplication");
    Console.WriteLine();
    Console.WriteLine("   Design the configuration for a service that runs in Development,");
    Console.WriteLine("   Staging and Production, where:");
    Console.WriteLine();
    Console.WriteLine("     - the gateway URL differs in all three;");
    Console.WriteLine("     - the timeout is 30s locally and 5s deployed;");
    Console.WriteLine("     - the API key must never be in the repository;");
    Console.WriteLine("     - a missing gateway URL must stop the process, not fall back.");
    Console.WriteLine();

    Console.WriteLine("   environment   BaseUrl                        Timeout   ApiKey   startup");
    Console.WriteLine("   -----------   -------                        -------   ------   -------");

    foreach ((string environment, string? envUrl, string? envKey) in new[]
    {
        ("Development", null, "dev-key-from-user-secrets"),
        ("Staging", "https://gw-staging.internal", "staging-key-from-vault"),
        ("Production", "https://gw.internal:8443", "prod-key-from-vault"),
        ("Production", null, "prod-key-from-vault")
    })
    {
        // Layer 1: committed defaults. NO BaseUrl - it has no safe default, so
        // there is nothing to fall back to.
        var sources = new ConfigurationBuilder()
            .AddInMemoryCollection(Flatten("""
            { "Gateway": { "TimeoutSeconds": 5, "MaxAttempts": 3 } }
            """));

        // Layer 2: the committed per-environment file.
        if (environment == "Development")
        {
            sources.AddInMemoryCollection(Flatten("""
            { "Gateway": { "BaseUrl": "https://localhost:9443", "TimeoutSeconds": 30 } }
            """));
        }

        // Layer 3: what the platform sets, which no file contains.
        var platform = new Dictionary<string, string?>();

        if (envUrl is not null)
        {
            platform["Gateway:BaseUrl"] = envUrl;
        }

        if (envKey is not null)
        {
            platform["Gateway:ApiKey"] = envKey;
        }

        sources.AddInMemoryCollection(platform);

        IConfigurationRoot configuration = sources.Build();
        GatewayOptions? options = configuration.GetSection("Gateway").Get<GatewayOptions>();

        // The check that turns a missing value into a failed startup.
        string startup = string.IsNullOrWhiteSpace(options?.BaseUrl)
            ? "REFUSED: Gateway:BaseUrl is required"
            : "started";

        Console.WriteLine($"   {environment,-11}   {options?.BaseUrl ?? "(none)",-29}   " +
            $"{options?.TimeoutSeconds,7}   {(options?.ApiKey is null or "" ? "no" : "yes"),-6}   {startup}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE DESIGN, and each line of it is answering one of the requirements:");
    Console.WriteLine();
    Console.WriteLine("     appsettings.json               TimeoutSeconds 5, MaxAttempts 3");
    Console.WriteLine("                                    NO BaseUrl and NO ApiKey");
    Console.WriteLine("     appsettings.Development.json   BaseUrl localhost, TimeoutSeconds 30");
    Console.WriteLine("     user secrets (Development)     ApiKey");
    Console.WriteLine("     environment variables          BaseUrl and ApiKey, deployed");
    Console.WriteLine();
    Console.WriteLine("   THE LOAD-BEARING DECISION IS THE ABSENCE. BaseUrl has no committed");
    Console.WriteLine("   value at all, so an environment that fails to set it has nothing to");
    Console.WriteLine("   fall back to and the last row refuses to start.");
    Console.WriteLine();
    Console.WriteLine("   Compare that with the production incident, where a committed default");
    Console.WriteLine("   existed and worked - which is precisely why the mistake survived");
    Console.WriteLine("   eleven days. A DEFAULT THAT WORKS IS A DEFAULT THAT HIDES A MISSING");
    Console.WriteLine("   SETTING.");
    Console.WriteLine();
    Console.WriteLine("   THE TIMEOUT GOES THE OTHER WAY, and the asymmetry is deliberate: 5");
    Console.WriteLine("   seconds is a safe production default, so it is committed, and only");
    Console.WriteLine("   Development overrides it. A setting with a correct default belongs in");
    Console.WriteLine("   the base file; a setting with no correct default belongs nowhere in");
    Console.WriteLine("   the repository.");
    Console.WriteLine();
    Console.WriteLine("   THE SECRET IS NEVER IN A FILE THAT IS COMMITTED - user secrets on a");
    Console.WriteLine("   developer machine, the platform's secret store when deployed. Both");
    Console.WriteLine("   arrive through the same configuration keys, so no code knows the");
    Console.WriteLine("   difference. That is the next module but one.");
}

// ---------------------------------------------------------------------------
static IConfigurationRoot Build(string json) =>
    new ConfigurationBuilder().AddInMemoryCollection(Flatten(json)).Build();

static Dictionary<string, string?> Flatten(string json)
{
    string path = Path.GetTempFileName();
    File.WriteAllText(path, json);

    try
    {
        IConfigurationRoot source = new ConfigurationBuilder()
            .AddJsonFile(path, optional: false)
            .Build();

        return source.AsEnumerable()
            .Where(pair => pair.Value is not null)
            .ToDictionary(pair => pair.Key, pair => pair.Value);
    }
    finally
    {
        File.Delete(path);
    }
}

// ---------------------------------------------------------------------------
public sealed class GatewayOptions
{
    public string BaseUrl { get; set; } = "";

    public int TimeoutSeconds { get; set; }

    public int MaxAttempts { get; set; }

    public string ApiKey { get; set; } = "";

    public override string ToString() =>
        $"BaseUrl={BaseUrl}, Timeout={TimeoutSeconds}, Attempts={MaxAttempts}";
}
