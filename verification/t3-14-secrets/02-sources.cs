// 02-sources.cs — Where a secret comes from in each environment, what user
// secrets actually are, and the one word that lets a vault fail silently.
//
// Run:  dotnet run 02-sources.cs -c Release
//
// EXACT vs RATIO: every outcome here is deterministic. Every credential in this
// file is invented and grants access to nothing.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Configuration;

UserSecrets();
await TheVault();
await OptionalIsATrap();
Comparison();

// ---------------------------------------------------------------------------
static void UserSecrets()
{
    Console.WriteLine("1. User secrets, which are a file somewhere else");
    Console.WriteLine();
    Console.WriteLine("   AddUserSecrets<Program>() reads a JSON file outside the repository,");
    Console.WriteLine("   found by an id that IS committed - in the project file:");
    Console.WriteLine();
    Console.WriteLine("     <UserSecretsId>a1b2c3d4-0000-0000-0000-000000000000</UserSecretsId>");
    Console.WriteLine();
    Console.WriteLine("   and the file lives at:");
    Console.WriteLine();

    string root = OperatingSystem.IsWindows()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Microsoft", "UserSecrets")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".microsoft", "usersecrets");

    Console.WriteLine($"     {Path.Combine(root, "<UserSecretsId>", "secrets.json")}");
    Console.WriteLine();
    Console.WriteLine($"   on this machine, which puts it under   {root}");
    Console.WriteLine();
    Console.WriteLine("   THE ID IS COMMITTED AND THE VALUES ARE NOT. That is the whole trick:");
    Console.WriteLine("   the repository says where to look, and what is found there belongs to");
    Console.WriteLine("   the developer.");
    Console.WriteLine();
    Console.WriteLine("   The file is ordinary JSON with the same keys as appsettings, so a");
    Console.WriteLine("   value moves between the two by cutting and pasting - which is exactly");
    Console.WriteLine("   how a secret ends up committed, and the reason to have a scanner.");
    Console.WriteLine();
    Console.WriteLine("   FOUR THINGS TO KNOW ABOUT THEM:");
    Console.WriteLine();
    Console.WriteLine("     - THEY ARE DEVELOPMENT ONLY. CreateBuilder adds the provider when");
    Console.WriteLine("       the environment is Development and not otherwise, so a deployed");
    Console.WriteLine("       service never reads them however the file got onto the machine.");
    Console.WriteLine();
    Console.WriteLine("     - THEY ARE NOT ENCRYPTED. The file is plain text with file-system");
    Console.WriteLine("       permissions and nothing else. They keep secrets out of the");
    Console.WriteLine("       repository; they do not protect them from anybody on the machine.");
    Console.WriteLine();
    Console.WriteLine("     - THEY ARE PER PROJECT AND PER USER, so two developers can hold");
    Console.WriteLine("       different credentials for the same key, which is usually what you");
    Console.WriteLine("       want and occasionally confusing.");
    Console.WriteLine();
    Console.WriteLine("     - dotnet user-secrets set \"Gateway:ApiKey\" \"...\" is the command,");
    Console.WriteLine("       and 'list' prints them, so it is not a place to put anything a");
    Console.WriteLine("       developer should not see.");
    Console.WriteLine();
    Console.WriteLine("   THE HONEST SUMMARY: user secrets solve exactly one problem, which is");
    Console.WriteLine("   that a developer needs a real credential and a repository must not");
    Console.WriteLine("   contain one. For that they are the right answer and there is no");
    Console.WriteLine("   reason to use anything else.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheVault()
{
    Console.WriteLine("2. A secret store, as a configuration provider");
    Console.WriteLine();
    Console.WriteLine("   Azure Key Vault, AWS Secrets Manager, HashiCorp Vault and the rest all");
    Console.WriteLine("   plug in the same way: as a configuration provider that fetches values");
    Console.WriteLine("   at startup and presents them as ordinary keys.");
    Console.WriteLine();
    Console.WriteLine("   The one below stands in for a real client, because no package is");
    Console.WriteLine("   available offline. The shape is what matters - it is what");
    Console.WriteLine("   AddAzureKeyVault and its equivalents do.");
    Console.WriteLine();

    var vault = new FakeSecretStore
    {
        ["Gateway--ApiKey"] = "sk-live-from-the-vault",
        ["ConnectionStrings--Ledger"] = "Server=db.internal;Database=ledger;Password=from-vault"
    };

    var builder = WebApplication.CreateBuilder(new WebApplicationOptions
    {
        EnvironmentName = "Production"
    });

    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Gateway:BaseUrl"] = "https://gw.internal:8443",
        ["Gateway:ApiKey"] = "(committed placeholder - never a real value)"
    });

    // Added last, so it wins - which is the point.
    ((IConfigurationBuilder)builder.Configuration).Add(new VaultConfigurationSource(vault, optional: false));

    var app = builder.Build();

    Console.WriteLine($"   Gateway:BaseUrl            {app.Configuration["Gateway:BaseUrl"]}");
    Console.WriteLine($"   Gateway:ApiKey             {Fingerprint(app.Configuration["Gateway:ApiKey"])}");
    Console.WriteLine($"   ConnectionStrings:Ledger   {Fingerprint(app.Configuration["ConnectionStrings:Ledger"])}");
    Console.WriteLine($"   secrets fetched            {vault.Reads}");
    Console.WriteLine();

    await app.DisposeAsync();

    Console.WriteLine("   TWO DETAILS THAT MATTER MORE THAN THE PROVIDER:");
    Console.WriteLine();
    Console.WriteLine("   THE NAME MAPPING. Most stores do not allow a colon in a secret name,");
    Console.WriteLine("   so the convention is a double dash: 'Gateway--ApiKey' in the vault");
    Console.WriteLine("   becomes 'Gateway:ApiKey' in configuration. It is the same problem as");
    Console.WriteLine("   the double underscore in environment variables, with a different");
    Console.WriteLine("   character and the same failure mode - a name that is nearly right");
    Console.WriteLine("   produces a key nothing reads.");
    Console.WriteLine();
    Console.WriteLine("   THE FETCH HAPPENS ONCE, AT STARTUP. The count above is 2 and stays 2:");
    Console.WriteLine("   a configuration provider is asked to Load, it produces a dictionary,");
    Console.WriteLine("   and the vault is not consulted again. That is why rotation is a");
    Console.WriteLine("   separate problem, and it is the next file.");
    Console.WriteLine();
    Console.WriteLine("   HOW THE APPLICATION AUTHENTICATES TO THE VAULT is the question this");
    Console.WriteLine("   design has to answer and cannot answer with a secret, because that");
    Console.WriteLine("   would need a secret to fetch the secrets.");
    Console.WriteLine();
    Console.WriteLine("   The answer everywhere is an identity supplied by the platform - a");
    Console.WriteLine("   managed identity, an instance role, a workload identity token mounted");
    Console.WriteLine("   into the container. The credential that proves who the process is");
    Console.WriteLine("   comes from the infrastructure it runs on, and is the one credential");
    Console.WriteLine("   that is never a string anybody types.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task OptionalIsATrap()
{
    Console.WriteLine("3. The word that lets it fail silently");
    Console.WriteLine();
    Console.WriteLine("   The vault is unreachable - a network policy, an expired identity, a");
    Console.WriteLine("   region outage. What the application does depends on one argument:");
    Console.WriteLine();

    Console.WriteLine("   registered as        startup      Gateway:ApiKey resolves to");
    Console.WriteLine("   -------------        -------      --------------------------");

    foreach (bool optional in new[] { true, false })
    {
        var vault = new FakeSecretStore { Broken = true };

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = "Production"
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:BaseUrl"] = "https://gw.internal:8443"
        });

        string label = optional ? "optional: true" : "optional: false";

        try
        {
            ((IConfigurationBuilder)builder.Configuration).Add(new VaultConfigurationSource(vault, optional));

            WebApplication app = builder.Build();

            Console.WriteLine($"   {label,-19}  {"started",-11}  " +
                $"{app.Configuration["Gateway:ApiKey"] ?? "(null)"}");

            await app.DisposeAsync();
        }
        catch (Exception exception)
        {
            Console.WriteLine($"   {label,-19}  {"REFUSED",-11}  {exception.GetType().Name}: " +
                $"{exception.Message}");
        }
    }

    Console.WriteLine();
    Console.WriteLine("   optional: true MEANS 'START WITHOUT THE SECRETS'. The application");
    Console.WriteLine("   comes up, binds its port, passes its health check, and every call");
    Console.WriteLine("   that needs a credential fails - one at a time, as requests arrive.");
    Console.WriteLine();
    Console.WriteLine("   It is the right setting for a source that legitimately may not exist:");
    Console.WriteLine("   an environment-specific file, an override that most deployments do");
    Console.WriteLine("   not have. It is the wrong setting for the store your application");
    Console.WriteLine("   cannot work without.");
    Console.WriteLine();
    Console.WriteLine("   WHY IT GETS SET ANYWAY: it is often the value in the sample code, and");
    Console.WriteLine("   it makes local development work without a vault. Both are real");
    Console.WriteLine("   reasons, and both are solved better by adding the provider only in");
    Console.WriteLine("   the environments that have one:");
    Console.WriteLine();
    Console.WriteLine("     if (!builder.Environment.IsDevelopment())");
    Console.WriteLine("     {");
    Console.WriteLine("         builder.Configuration.AddAzureKeyVault(uri, credential);");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   THE PRINCIPLE: A PROVIDER THAT IS PRESENT MUST BE REQUIRED. Deciding");
    Console.WriteLine("   whether a source exists belongs at registration, where it is visible,");
    Console.WriteLine("   not in an argument that turns a failure into a shrug.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Comparison()
{
    Console.WriteLine("4. Which source for which environment");
    Console.WriteLine();
    Console.WriteLine("   source                  environment     protects against");
    Console.WriteLine("   ------                  -----------     ----------------");
    Console.WriteLine("   user secrets            Development     committing to the repository");
    Console.WriteLine("   environment variables   any deployed    committing, and image layers");
    Console.WriteLine("   a secret store          any deployed    committing, image layers, and");
    Console.WriteLine("                                           anybody with cluster access");
    Console.WriteLine();
    Console.WriteLine("   READ THE THIRD COLUMN AS A LADDER, because that is what it is.");
    Console.WriteLine();
    Console.WriteLine("   ENVIRONMENT VARIABLES ARE VISIBLE TO ANYBODY WHO CAN DESCRIBE THE");
    Console.WriteLine("   WORKLOAD. A Kubernetes secret is base64, which is an encoding and not");
    Console.WriteLine("   encryption; 'kubectl describe pod' shows the names and 'kubectl get");
    Console.WriteLine("   secret -o yaml' shows the values to anybody with the permission. They");
    Console.WriteLine("   also appear in a process listing on some systems, and in a crash dump");
    Console.WriteLine("   of your own process.");
    Console.WriteLine();
    Console.WriteLine("   A SECRET STORE ADDS THREE THINGS variables cannot:");
    Console.WriteLine();
    Console.WriteLine("     - access is per-identity and audited, so you can answer 'who read");
    Console.WriteLine("       this credential' after an incident;");
    Console.WriteLine();
    Console.WriteLine("     - the value can be changed without redeploying anything, which is");
    Console.WriteLine("       what makes routine rotation possible;");
    Console.WriteLine();
    Console.WriteLine("     - it is one place to revoke from, rather than every manifest that");
    Console.WriteLine("       happens to carry a copy.");
    Console.WriteLine();
    Console.WriteLine("   WHEN VARIABLES ARE ENOUGH: a small service, a small team, and a");
    Console.WriteLine("   credential you would rotate by editing one manifest. That is a");
    Console.WriteLine("   legitimate position and it is worth holding deliberately rather than");
    Console.WriteLine("   by default, because the thing it gives up is the audit trail, and you");
    Console.WriteLine("   discover you needed that only once.");
}

// ---------------------------------------------------------------------------
static string Fingerprint(string? secret)
{
    if (string.IsNullOrEmpty(secret))
    {
        return "(none)";
    }

    byte[] hash = System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(secret));

    return $"sha256:{Convert.ToHexString(hash)[..8].ToLowerInvariant()}";
}

// ---------------------------------------------------------------------------
// Stands in for a secret store client. Names use the double dash the real
// stores require, because a colon is not a legal secret name.
public sealed class FakeSecretStore : Dictionary<string, string>
{
    private int _reads;

    public bool Broken { get; set; }

    public int Reads => _reads;

    public Dictionary<string, string> Fetch()
    {
        if (Broken)
        {
            throw new InvalidOperationException("the secret store is unreachable");
        }

        Interlocked.Add(ref _reads, Count);

        return new Dictionary<string, string>(this);
    }
}

public sealed class VaultConfigurationSource(FakeSecretStore store, bool optional)
    : IConfigurationSource
{
    public IConfigurationProvider Build(IConfigurationBuilder builder) =>
        new VaultConfigurationProvider(store, optional);
}

public sealed class VaultConfigurationProvider(FakeSecretStore store, bool optional)
    : ConfigurationProvider
{
    public override void Load()
    {
        try
        {
            foreach ((string name, string value) in store.Fetch())
            {
                // The store's naming convention translated into configuration's.
                Data[name.Replace("--", ":")] = value;
            }
        }
        catch (Exception) when (optional)
        {
            // Exactly what optional: true means, and it is worth seeing written
            // down: the failure is caught and discarded.
        }
    }
}
