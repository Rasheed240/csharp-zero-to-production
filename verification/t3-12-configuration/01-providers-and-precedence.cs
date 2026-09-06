// 01-providers-and-precedence.cs — What CreateBuilder actually registers, in
// what order, and the three things about that order that surprise people.
//
// Run:  dotnet run 01-providers-and-precedence.cs -c Release
//
// EXACT vs RATIO: every provider name, key and value here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Configuration;

string root = Directory.CreateTempSubdirectory("cfg-providers").FullName;

WhatIsRegistered();
Precedence();
EnvironmentVariableNames();
CaseAndMissing();

Directory.Delete(root, recursive: true);

// ---------------------------------------------------------------------------
void WhatIsRegistered()
{
    Console.WriteLine("1. The default chain");
    Console.WriteLine();

    File.WriteAllText(Path.Combine(root, "appsettings.json"), """{"Marker":"base"}""");
    File.WriteAllText(Path.Combine(root, "appsettings.Production.json"), """{"Marker":"env-file"}""");

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production",
        ContentRootPath = root,
        Args = ["--Marker=command-line"]
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    Console.WriteLine("   in the order they are read, first to last:");
    Console.WriteLine();

    int position = 0;

    foreach (IConfigurationSource source in ((IConfigurationBuilder)builder.Configuration).Sources)
    {
        string name = source.GetType().Name.Replace("ConfigurationSource", "");
        string detail = source switch
        {
            Microsoft.Extensions.Configuration.Json.JsonConfigurationSource json => json.Path ?? "",
            Microsoft.Extensions.Configuration.EnvironmentVariables.EnvironmentVariablesConfigurationSource ev =>
                string.IsNullOrEmpty(ev.Prefix) ? "(no prefix)" : $"prefix {ev.Prefix}",
            _ => ""
        };

        Console.WriteLine($"   {++position,2}. {name,-24} {detail}");
    }

    Console.WriteLine();
    Console.WriteLine($"   Marker resolves to   {builder.Configuration["Marker"]}");
    Console.WriteLine();
    Console.WriteLine("   TWO ENTRIES IN THAT LIST ARE NOT IN A NORMAL APPLICATION. The pair");
    Console.WriteLine("   named after this .cs file are added because this is a file-based app");
    Console.WriteLine("   run with 'dotnet run file.cs'; a project-based application has only");
    Console.WriteLine("   the appsettings pair. Everything else in the list is what you get.");
    Console.WriteLine();
    Console.WriteLine("   NOTE ALSO WHAT IS ABSENT: there is no user-secrets provider, because");
    Console.WriteLine("   this ran as Production and secrets are added in Development only.");
    Console.WriteLine();
    Console.WriteLine("   READ THE LIST AS A PRIORITY ORDER, LOWEST FIRST. The last source that");
    Console.WriteLine("   has a key wins, so everything below overrides everything above it.");
    Console.WriteLine();
    Console.WriteLine("   The shape of it, ignoring the ones that only matter to the host:");
    Console.WriteLine();
    Console.WriteLine("     appsettings.json                 committed, the defaults");
    Console.WriteLine("     appsettings.{Environment}.json   committed, the per-environment bits");
    Console.WriteLine("     user secrets (Development only)  on your machine, never committed");
    Console.WriteLine("     environment variables            what the platform sets");
    Console.WriteLine("     command line arguments           what you type, and it wins");
    Console.WriteLine();
    Console.WriteLine("   THAT ORDER IS A DESIGN, and it reads outward from the repository: the");
    Console.WriteLine("   further a value is from source control, the more authority it has.");
    Console.WriteLine("   Committed defaults lose to the machine, which loses to the operator.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
void Precedence()
{
    Console.WriteLine("2. Which source is actually answering");
    Console.WriteLine();
    Console.WriteLine("   The same key present in a different number of sources each time:");
    Console.WriteLine();

    Console.WriteLine("   present in                                       resolves to");
    Console.WriteLine("   ----------                                       -----------");

    foreach ((string label, bool envFile, bool envVar, bool commandLine) in new[]
    {
        ("appsettings.json only", false, false, false),
        ("+ appsettings.Production.json", true, false, false),
        ("+ an environment variable", true, true, false),
        ("+ a command line argument", true, true, true),
        ("environment variable, no env file", false, true, false)
    })
    {
        string directory = Directory.CreateTempSubdirectory("cfg-prec").FullName;

        File.WriteAllText(Path.Combine(directory, "appsettings.json"), """{"Marker":"base"}""");

        if (envFile)
        {
            File.WriteAllText(Path.Combine(directory, "appsettings.Production.json"),
                """{"Marker":"env-file"}""");
        }

        if (envVar)
        {
            Environment.SetEnvironmentVariable("Marker", "environment-variable");
        }

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production",
            ContentRootPath = directory,
            Args = commandLine ? ["--Marker=command-line"] : []
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        Console.WriteLine($"   {label,-46}   {builder.Configuration["Marker"]}");

        Environment.SetEnvironmentVariable("Marker", null);
        Directory.Delete(directory, recursive: true);
    }

    Console.WriteLine();
    Console.WriteLine("   Nothing surprising yet, and that is worth saying: THE ORDER IS THE");
    Console.WriteLine("   WHOLE MECHANISM, and it behaves exactly as advertised.");
    Console.WriteLine();
    Console.WriteLine("   The last row matters for deployment. An environment variable wins");
    Console.WriteLine("   whether or not an environment file exists, so a platform can override");
    Console.WriteLine("   any committed value without the repository knowing that environment");
    Console.WriteLine("   exists.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
void EnvironmentVariableNames()
{
    Console.WriteLine("3. The name an environment variable has to have");
    Console.WriteLine();
    Console.WriteLine("   The setting is Gateway:BaseUrl. Four spellings, one of which is the");
    Console.WriteLine("   one that works everywhere:");
    Console.WriteLine();

    Console.WriteLine("   variable name              resolves Gateway:BaseUrl to");
    Console.WriteLine("   -------------              ---------------------------");

    foreach (string name in new[]
    {
        "Gateway__BaseUrl",
        "Gateway:BaseUrl",
        "GATEWAY__BASEURL",
        "Gateway_BaseUrl"
    })
    {
        Environment.SetEnvironmentVariable(name, $"set-via-{name}");

        IConfigurationRoot configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Gateway:BaseUrl"] = "(from json)" })
            .AddEnvironmentVariables()
            .Build();

        Console.WriteLine($"   {name,-25}  {configuration["Gateway:BaseUrl"]}");

        Environment.SetEnvironmentVariable(name, null);
    }

    Console.WriteLine();
    Console.WriteLine("   DOUBLE UNDERSCORE IS THE SEPARATOR, and it is the only spelling to");
    Console.WriteLine("   use. A colon works on Windows and is not a legal character in an");
    Console.WriteLine("   environment variable name on Linux, so a compose file or a Kubernetes");
    Console.WriteLine("   manifest that uses one is silently ignored there.");
    Console.WriteLine();
    Console.WriteLine("   Case does not matter, which is why the third row works.");
    Console.WriteLine();
    Console.WriteLine("   THE FOURTH ROW IS THE ONE THAT COSTS PEOPLE AN AFTERNOON. A single");
    Console.WriteLine("   underscore is not a separator: it is part of the key name. So");
    Console.WriteLine("   Gateway_BaseUrl defines a top-level key called 'Gateway_BaseUrl',");
    Console.WriteLine("   which nothing reads, and the value you set has no effect on anything.");
    Console.WriteLine();
    Console.WriteLine("   Nothing warns. The application starts with the committed default and");
    Console.WriteLine("   the operator is looking at a variable that is definitely set.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
void CaseAndMissing()
{
    Console.WriteLine("4. Keys are case-insensitive, and absent keys are not errors");
    Console.WriteLine();

    IConfigurationRoot configuration = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:TimeoutSeconds"] = "30",
            ["Gateway:Retries"] = "not-a-number"
        })
        .Build();

    Console.WriteLine("   how it is asked for                        what comes back");
    Console.WriteLine("   -------------------                        ---------------");
    Console.WriteLine($"   [\"Gateway:TimeoutSeconds\"]                  {Show(configuration["Gateway:TimeoutSeconds"])}");
    Console.WriteLine($"   [\"gateway:timeoutseconds\"]                  {Show(configuration["gateway:timeoutseconds"])}");
    Console.WriteLine($"   [\"GATEWAY:TIMEOUTSECONDS\"]                  {Show(configuration["GATEWAY:TIMEOUTSECONDS"])}");
    Console.WriteLine($"   [\"Gateway:Timeout\"] (misspelt)              {Show(configuration["Gateway:Timeout"])}");
    Console.WriteLine($"   GetValue<int>(\"Gateway:Timeout\")            {configuration.GetValue<int>("Gateway:Timeout")}");
    Console.WriteLine($"   GetValue<int>(\"Gateway:Timeout\", 30)        {configuration.GetValue("Gateway:Timeout", 30)}");
    Console.WriteLine($"   GetValue<int>(\"Gateway:TimeoutSeconds\")     {configuration.GetValue<int>("Gateway:TimeoutSeconds")}");

    Console.Write("   GetValue<int>(\"Gateway:Retries\")            ");

    try
    {
        Console.WriteLine(configuration.GetValue<int>("Gateway:Retries"));
    }
    catch (Exception exception)
    {
        Console.WriteLine($"{exception.GetType().Name}");
    }

    Console.WriteLine();
    Console.WriteLine("   TWO BEHAVIOURS TO INTERNALISE, and they pull in opposite directions.");
    Console.WriteLine();
    Console.WriteLine("   A KEY THAT IS PRESENT AND UNPARSEABLE THROWS. That is the good case:");
    Console.WriteLine("   the value is wrong, you are told, and the application fails.");
    Console.WriteLine();
    Console.WriteLine("   A KEY THAT IS ABSENT RETURNS default(T) IN SILENCE. GetValue<int> on a");
    Console.WriteLine("   misspelt key returns 0. Not null, not an error - zero, which is a");
    Console.WriteLine("   perfectly good timeout, retry count or page size as far as the rest of");
    Console.WriteLine("   your code can tell.");
    Console.WriteLine();
    Console.WriteLine("   THE ASYMMETRY IS THE WHOLE PROBLEM: a wrong value is loud and a");
    Console.WriteLine("   MISSING value is silent, and a typo produces the silent one.");
    Console.WriteLine();
    Console.WriteLine("   Case-insensitivity makes it slightly worse, because it removes one of");
    Console.WriteLine("   the ways a typo could have been caught. 'gateway:timeoutseconds' is");
    Console.WriteLine("   fine; 'gateway:timeout_seconds' is a different key entirely.");
    Console.WriteLine();
    Console.WriteLine("   The answer is not to be careful. It is to stop reading configuration");
    Console.WriteLine("   by string at all, which is the next section and the next module.");
}

static string Show(string? value) => value is null ? "(null)" : value;
