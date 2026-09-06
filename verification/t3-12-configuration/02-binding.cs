// 02-binding.cs — Turning a flat dictionary of strings into an object, and the
// four ways that goes quietly wrong.
//
// Run:  dotnet run 02-binding.cs -c Release
//
// EXACT vs RATIO: every value and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

// This file compares binding APIs, so it builds a provider directly.
#pragma warning disable ASP0000

TheBasicShape();
WhatBindingIgnores();
Arrays();
Reloading();

// ---------------------------------------------------------------------------
static void TheBasicShape()
{
    Console.WriteLine("1. From strings to an object");
    Console.WriteLine();

    IConfigurationRoot configuration = Build("""
    {
      "Gateway": {
        "BaseUrl": "https://gw.internal:8443",
        "TimeoutSeconds": 5,
        "MaxAttempts": 3,
        "Enabled": true
      }
    }
    """);

    // Three ways to read the same section.
    string? byKey = configuration["Gateway:BaseUrl"];
    int byValue = configuration.GetValue<int>("Gateway:TimeoutSeconds");
    GatewayOptions? bound = configuration.GetSection("Gateway").Get<GatewayOptions>();

    Console.WriteLine($"   configuration[\"Gateway:BaseUrl\"]                 {byKey}");
    Console.WriteLine($"   GetValue<int>(\"Gateway:TimeoutSeconds\")          {byValue}");
    Console.WriteLine($"   GetSection(\"Gateway\").Get<GatewayOptions>()      {bound}");
    Console.WriteLine();
    Console.WriteLine("   BINDING MATCHES PROPERTY NAMES TO KEYS, case-insensitively, and");
    Console.WriteLine("   converts each string to the property's type. That is the whole of it.");
    Console.WriteLine();
    Console.WriteLine("   Why the third line is the one to use:");
    Console.WriteLine();
    Console.WriteLine("     - the key names appear ONCE, in the class, instead of at every");
    Console.WriteLine("       place that reads them;");
    Console.WriteLine("     - the types are declared, so a value that will not convert fails");
    Console.WriteLine("       here rather than at the call site;");
    Console.WriteLine("     - the rest of your code takes GatewayOptions and never sees");
    Console.WriteLine("       IConfiguration, which makes it testable without configuration.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatBindingIgnores()
{
    Console.WriteLine("2. What binding does with things that do not match");
    Console.WriteLine();

    Console.WriteLine("   configuration says                    bound object");
    Console.WriteLine("   ------------------                    ------------");

    // Everything present and correct.
    Report("everything present", """
    { "Gateway": { "BaseUrl": "https://a", "TimeoutSeconds": 5, "MaxAttempts": 3, "Enabled": true } }
    """);

    // A key missing entirely.
    Report("TimeoutSeconds absent", """
    { "Gateway": { "BaseUrl": "https://a", "MaxAttempts": 3, "Enabled": true } }
    """);

    // A key misspelt in the file.
    Report("TimeoutSecond (misspelt)", """
    { "Gateway": { "BaseUrl": "https://a", "TimeoutSecond": 5, "MaxAttempts": 3, "Enabled": true } }
    """);

    // A key the class does not have.
    Report("an extra key", """
    { "Gateway": { "BaseUrl": "https://a", "TimeoutSeconds": 5, "MaxAttempts": 3, "Enabled": true,
                   "RetryJitterMs": 250 } }
    """);

    // The whole section missing.
    Report("no Gateway section at all", """{ "Other": { "Thing": 1 } }""");

    Console.WriteLine();
    Console.WriteLine("   EVERY ROW SUCCEEDED. Nothing threw, nothing was logged, and three of");
    Console.WriteLine("   the five produced an object that is wrong or absent.");
    Console.WriteLine();
    Console.WriteLine("   The rules binding follows, stated as what they cost you:");
    Console.WriteLine();
    Console.WriteLine("     A KEY WITH NO PROPERTY IS IGNORED. RetryJitterMs was set by somebody");
    Console.WriteLine("     who believed it did something. It does nothing, and the file looks");
    Console.WriteLine("     exactly as intended.");
    Console.WriteLine();
    Console.WriteLine("     A PROPERTY WITH NO KEY KEEPS WHATEVER THE CLASS INITIALISED IT TO,");
    Console.WriteLine("     which for an int with no initialiser is ZERO. A timeout of 0 and a");
    Console.WriteLine("     retry count of 0 are both valid-looking numbers.");
    Console.WriteLine();
    Console.WriteLine("     A MISSING SECTION IS THE ONE CASE THE THREE BINDING APIS DISAGREE");
    Console.WriteLine("     ABOUT, which is worth measuring rather than assuming:");
    Console.WriteLine();

    IConfigurationRoot empty = Build("""{ "Other": { "Thing": 1 } }""");

    GatewayOptions? viaGet = empty.GetSection("Gateway").Get<GatewayOptions>();

    var viaBind = new GatewayOptions { BaseUrl = "https://default", TimeoutSeconds = 30 };
    empty.GetSection("Gateway").Bind(viaBind);

    var services = new ServiceCollection();
    services.Configure<GatewayOptions>(empty.GetSection("Gateway"));

    using ServiceProvider provider = services.BuildServiceProvider();
    GatewayOptions viaOptions = provider.GetRequiredService<IOptions<GatewayOptions>>().Value;

    Console.WriteLine($"       Get<GatewayOptions>()        {(viaGet is null ? "null" : viaGet.ToString())}");
    Console.WriteLine($"       Bind(existing instance)      {viaBind}");
    Console.WriteLine($"       Configure + IOptions.Value   {viaOptions}");
    Console.WriteLine();
    Console.WriteLine("     Get RETURNS null. Bind LEAVES THE INSTANCE ALONE, so whatever you");
    Console.WriteLine("     constructed it with survives. Configure gives you a fresh object of");
    Console.WriteLine("     type defaults - zeros, here.");
    Console.WriteLine();
    Console.WriteLine("     Only the middle one is safe by accident, and only because the caller");
    Console.WriteLine("     supplied defaults first. The third is the one applications actually");
    Console.WriteLine("     use, and it makes 'the section is missing' indistinguishable from");
    Console.WriteLine("     'the section says zero'.");
    Console.WriteLine();
    Console.WriteLine("   THE SHAPE OF ALL THREE IS THE SAME: binding is a BEST-EFFORT MATCH,");
    Console.WriteLine("   not a contract. It reports nothing because from its point of view");
    Console.WriteLine("   nothing went wrong.");
    Console.WriteLine();
    Console.WriteLine("   TWO PARTIAL DEFENCES, and neither is enough on its own:");
    Console.WriteLine();
    Console.WriteLine("     1. GIVE EVERY PROPERTY A SENSIBLE DEFAULT in the class, so an absent");
    Console.WriteLine("        key produces a working value rather than zero. This turns silent");
    Console.WriteLine("        breakage into silent-but-harmless.");
    Console.WriteLine();
    Console.WriteLine("     2. ErrorOnUnknownConfiguration, which makes the fourth row throw:");
    Console.WriteLine();

    try
    {
        IConfigurationRoot configuration = Build("""
        { "Gateway": { "BaseUrl": "https://a", "TimeoutSeconds": 5, "MaxAttempts": 3,
                       "Enabled": true, "RetryJitterMs": 250 } }
        """);

        configuration.GetSection("Gateway").Get<GatewayOptions>(
            options => options.ErrorOnUnknownConfiguration = true);

        Console.WriteLine("        (no exception)");
    }
    catch (Exception exception)
    {
        string message = exception.Message.ReplaceLineEndings(" ");

        Console.WriteLine($"        {exception.GetType().Name}: " +
            $"{(message.Length > 88 ? message[..88] + "..." : message)}");
    }

    Console.WriteLine();
    Console.WriteLine("   That catches the extra key and says nothing about the missing one,");
    Console.WriteLine("   which is the more damaging of the two. THE REAL ANSWER IS VALIDATION");
    Console.WriteLine("   AT STARTUP, and it is the subject of the next module.");
    Console.WriteLine();

    static void Report(string label, string json)
    {
        GatewayOptions? bound = Build(json).GetSection("Gateway").Get<GatewayOptions>();

        Console.WriteLine($"   {label,-36}  {bound}");
    }
}

// ---------------------------------------------------------------------------
static void Arrays()
{
    Console.WriteLine("3. Arrays, which do not behave the way the rest of it does");
    Console.WriteLine();
    Console.WriteLine("   A base file lists three allowed origins. An environment file lists");
    Console.WriteLine("   one, intending to replace them:");
    Console.WriteLine();

    IConfigurationRoot configuration = new ConfigurationBuilder()
        .AddInMemoryCollection(Flatten("""
        { "Cors": { "AllowedOrigins": [ "https://a.example", "https://b.example", "https://c.example" ] } }
        """))
        .AddInMemoryCollection(Flatten("""
        { "Cors": { "AllowedOrigins": [ "https://only-this-one.example" ] } }
        """))
        .Build();

    CorsOptions? cors = configuration.GetSection("Cors").Get<CorsOptions>();

    Console.WriteLine("   base file      a.example, b.example, c.example");
    Console.WriteLine("   override file  only-this-one.example");
    Console.WriteLine();
    Console.WriteLine($"   the application gets   {string.Join(", ", cors?.AllowedOrigins ?? [])}");
    Console.WriteLine();
    Console.WriteLine("   the raw keys, which explain it:");
    Console.WriteLine();

    foreach (IConfigurationSection child in configuration.GetSection("Cors:AllowedOrigins").GetChildren())
    {
        Console.WriteLine($"     Cors:AllowedOrigins:{child.Key}   {child.Value}");
    }

    Console.WriteLine();
    Console.WriteLine("   AN ARRAY IS NOT A VALUE. It is a set of keys named 0, 1, 2, and the");
    Console.WriteLine("   later source only has a key named 0. So it overwrote element 0 and");
    Console.WriteLine("   LEFT ELEMENTS 1 AND 2 IN PLACE.");
    Console.WriteLine();
    Console.WriteLine("   The result is a list that was never written down anywhere: one entry");
    Console.WriteLine("   from the override and two from the base. For an allow-list that is a");
    Console.WriteLine("   security defect - two origins nobody intended to permit in this");
    Console.WriteLine("   environment are permitted, and the file that was supposed to restrict");
    Console.WriteLine("   them looks correct.");
    Console.WriteLine();
    Console.WriteLine("   THERE IS NO WAY TO SHORTEN AN ARRAY FROM A LATER SOURCE. The obvious");
    Console.WriteLine("   attempt is to set the unwanted elements to null:");
    Console.WriteLine();

    IConfigurationRoot nulled = new ConfigurationBuilder()
        .AddInMemoryCollection(Flatten("""
        { "Cors": { "AllowedOrigins": [ "https://a.example", "https://b.example", "https://c.example" ] } }
        """))
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Cors:AllowedOrigins:0"] = "https://only-this-one.example",
            ["Cors:AllowedOrigins:1"] = null,
            ["Cors:AllowedOrigins:2"] = null
        })
        .Build();

    CorsOptions? afterNulls = nulled.GetSection("Cors").Get<CorsOptions>();

    Console.WriteLine($"     origins after nulling 1 and 2   {afterNulls?.AllowedOrigins.Count} entries");

    for (int index = 0; index < (afterNulls?.AllowedOrigins.Count ?? 0); index++)
    {
        Console.WriteLine($"       [{index}]  {afterNulls!.AllowedOrigins[index] ?? "(null)"}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE LIST IS STILL THREE LONG. A null value does not delete a key; it");
    Console.WriteLine("   sets that element to null, and binding hands you a list containing");
    Console.WriteLine("   nulls - which is worse than the original problem, because now the");
    Console.WriteLine("   code that iterates it has to cope with them.");
    Console.WriteLine();
    Console.WriteLine("   WHAT TO DO INSTEAD, in order of preference:");
    Console.WriteLine();
    Console.WriteLine("     1. Do not override arrays across sources. Define each list once, in");
    Console.WriteLine("        one file, and let the environment file own the whole list if it");
    Console.WriteLine("        needs a different one.");
    Console.WriteLine();
    Console.WriteLine("     2. If it must be overridable, use a delimited string and split it -");
    Console.WriteLine("        one key, one value, ordinary last-wins behaviour.");
    Console.WriteLine();
    Console.WriteLine("     3. Whatever you choose, LOG THE RESOLVED LIST AT STARTUP. This is");
    Console.WriteLine("        the class of bug where the only reliable check is printing what");
    Console.WriteLine("        the application actually ended up with.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Reloading()
{
    Console.WriteLine("4. Reloading, and what does not reload");
    Console.WriteLine();

    string directory = Directory.CreateTempSubdirectory("cfg-reload").FullName;
    string path = Path.Combine(directory, "settings.json");

    File.WriteAllText(path, """{ "Gateway": { "TimeoutSeconds": 5 } }""");

    IConfigurationRoot configuration = new ConfigurationBuilder()
        .AddJsonFile(path, optional: false, reloadOnChange: true)
        .Build();

    // Bound once, before the change.
    GatewayOptions? boundEarly = configuration.GetSection("Gateway").Get<GatewayOptions>();

    Console.WriteLine($"   before   configuration value   {configuration["Gateway:TimeoutSeconds"]}");
    Console.WriteLine($"            object bound earlier  {boundEarly?.TimeoutSeconds}");

    File.WriteAllText(path, """{ "Gateway": { "TimeoutSeconds": 30 } }""");

    // The file watcher is not instant; wait for the value to change rather than
    // for a fixed time, so this is not a race.
    for (int attempt = 0; attempt < 100 && configuration["Gateway:TimeoutSeconds"] != "30"; attempt++)
    {
        Thread.Sleep(20);
    }

    GatewayOptions? boundAfter = configuration.GetSection("Gateway").Get<GatewayOptions>();

    Console.WriteLine();
    Console.WriteLine($"   after    configuration value   {configuration["Gateway:TimeoutSeconds"]}");
    Console.WriteLine($"            object bound earlier  {boundEarly?.TimeoutSeconds}");
    Console.WriteLine($"            object bound again    {boundAfter?.TimeoutSeconds}");
    Console.WriteLine();
    Console.WriteLine("   THE CONFIGURATION RELOADED AND THE BOUND OBJECT DID NOT, because they");
    Console.WriteLine("   are different things. Binding copies values into a new object; nothing");
    Console.WriteLine("   connects that object back to the source it came from.");
    Console.WriteLine();
    Console.WriteLine("   So reloadOnChange gives you a configuration that updates, and every");
    Console.WriteLine("   class that took a bound options object keeps the values it was");
    Console.WriteLine("   constructed with - which for a singleton is the values at startup,");
    Console.WriteLine("   forever.");
    Console.WriteLine();
    Console.WriteLine("   That gap is exactly what IOptionsSnapshot and IOptionsMonitor exist to");
    Console.WriteLine("   close, and it is the whole subject of the next module.");
    Console.WriteLine();
    Console.WriteLine("   WHETHER YOU WANT RELOADING AT ALL is a real question, and the honest");
    Console.WriteLine("   answer for most services is no:");
    Console.WriteLine();
    Console.WriteLine("     - a value that changes under a running process is a value that");
    Console.WriteLine("       differs between two requests for reasons no log records;");
    Console.WriteLine("     - the containerised deployment model restarts the process to change");
    Console.WriteLine("       configuration anyway, so the feature buys nothing;");
    Console.WriteLine("     - a partially-written file can be read mid-write, so a reload can");
    Console.WriteLine("       observe a state that never existed as a whole.");
    Console.WriteLine();
    Console.WriteLine("   Reloading earns its place for feature flags and log levels - things");
    Console.WriteLine("   you deliberately want to change without a restart. For a connection");
    Console.WriteLine("   string or a timeout, a restart is the clearer mechanism.");

    Directory.Delete(directory, recursive: true);
}

// ---------------------------------------------------------------------------
static IConfigurationRoot Build(string json) =>
    new ConfigurationBuilder().AddInMemoryCollection(Flatten(json)).Build();

// Turns a JSON document into the flat key/value pairs configuration actually
// stores, using the JSON provider itself so the flattening is the real one.
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

    public bool Enabled { get; set; }

    public override string ToString() =>
        $"BaseUrl={BaseUrl}, Timeout={TimeoutSeconds}, Attempts={MaxAttempts}, Enabled={Enabled}";
}

public sealed class CorsOptions
{
    public List<string> AllowedOrigins { get; set; } = [];
}
