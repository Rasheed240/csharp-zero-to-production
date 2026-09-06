// 01-how-they-escape.cs — Six ways a credential reaches somewhere it should
// not, measured, and what stops each one.
//
// Run:  dotnet run 01-how-they-escape.cs -c Release
//
// EXACT vs RATIO: every outcome here is deterministic. Every credential in this
// file is invented and grants access to nothing.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;
using System.Text.Json;

await TheStartupDump();
await TheExceptionMessage();
await TheErrorResponse();
await TheLogScope();
Elsewhere();

// ---------------------------------------------------------------------------
static async Task TheStartupDump()
{
    Console.WriteLine("1. The startup log that helped with the last incident");
    Console.WriteLine();
    Console.WriteLine("   The configuration module's advice was to log the resolved settings at");
    Console.WriteLine("   startup, with their sources. Done without care, this is the single");
    Console.WriteLine("   most reliable way to put a credential into a log store.");
    Console.WriteLine();

    IConfigurationRoot configuration = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Gateway:BaseUrl"] = "https://gw.internal:8443",
            ["Gateway:ApiKey"] = "sk-live-1111111111111111",
            ["ConnectionStrings:Ledger"] = "Server=db.internal;Database=ledger;Password=hunter2"
        })
        .Build();

    Console.WriteLine("   GetDebugView() with no redaction:");
    Console.WriteLine();

    foreach (string line in configuration.GetDebugView().Split('\n').Take(6))
    {
        Console.WriteLine($"     {line.TrimEnd()}");
    }

    Console.WriteLine();
    Console.WriteLine("   The redaction overload exists because this is the expected mistake.");
    Console.WriteLine("   Here it is, with the obvious predicate - on context.Key:");
    Console.WriteLine();

    string byKey = configuration.GetDebugView(context =>
        IsSensitive(context.Key) ? "***" : context.Value ?? "");

    foreach (string line in byKey.Split('\n').Take(6))
    {
        Console.WriteLine($"     {line.TrimEnd()}");
    }

    Console.WriteLine();
    Console.WriteLine("   READ THE FIRST ENTRY AGAIN. THE CONNECTION STRING IS STILL THERE, and");
    Console.WriteLine("   the predicate does match the string 'ConnectionStrings'.");
    Console.WriteLine();
    Console.WriteLine("   context.Key IS THE LEAF, NOT THE PATH. For the entry whose full path");
    Console.WriteLine("   is 'ConnectionStrings:Ledger', Key is 'Ledger' - which contains none");
    Console.WriteLine("   of the words a sensible predicate looks for.");
    Console.WriteLine();
    Console.WriteLine("   The same predicate against context.Path:");
    Console.WriteLine();

    string byPath = configuration.GetDebugView(context =>
        IsSensitive(context.Path) ? "***" : context.Value ?? "");

    foreach (string line in byPath.Split('\n').Take(6))
    {
        Console.WriteLine($"     {line.TrimEnd()}");
    }

    Console.WriteLine();
    Console.WriteLine("   USE context.Path. The failure above is exactly the shape this module");
    Console.WriteLine("   is about: a redaction that was written, reviewed, and covers the key");
    Console.WriteLine("   whose name happens to end in a sensitive word while missing the one");
    Console.WriteLine("   whose SECTION is named for it.");
    Console.WriteLine();
    Console.WriteLine("   Connection strings are the common casualty, because the convention");
    Console.WriteLine("   puts the sensitive word in the section name and a harmless database");
    Console.WriteLine("   name in the leaf.");
    Console.WriteLine();
    Console.WriteLine("   A log store is a copy of everything you logged, kept for months and");
    Console.WriteLine("   readable by more people than the running process is. Anything written");
    Console.WriteLine("   there is disclosed to all of them, and deleting it later does not");
    Console.WriteLine("   undo that - the credential must be rotated instead.");
    Console.WriteLine();
    Console.WriteLine("   WHAT COUNTS AS SENSITIVE, as a name test rather than a judgement:");
    Console.WriteLine("   key, secret, password, token, connectionstring, credential, pfx, pem.");
    Console.WriteLine("   Match case-insensitively on substrings and accept over-redacting - a");
    Console.WriteLine("   masked value that did not need masking costs nothing.");
    Console.WriteLine();

    await Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static async Task TheExceptionMessage()
{
    Console.WriteLine("2. The exception that quotes what it was given");
    Console.WriteLine();
    Console.WriteLine("   A credential is a string, and strings get passed to things that parse");
    Console.WriteLine("   them. When parsing fails, some of those things put the input into the");
    Console.WriteLine("   exception message.");
    Console.WriteLine();
    Console.WriteLine("   Eight ways to fail on a value carrying a secret:");
    Console.WriteLine();

    const string Secret = "sk-live-1111111111111111";

    Console.WriteLine("   what was called                   the message contains it   exception");
    Console.WriteLine("   ---------------                   -----------------------   ---------");

    Probe("new Uri(malformed)", () => new Uri($"https://gw.internal:8443 /c?api_key={Secret}"));
    Probe("int.Parse(secret)", () => int.Parse(Secret));
    Probe("Guid.Parse(secret)", () => Guid.Parse(Secret));
    Probe("Convert.FromBase64String", () => Convert.FromBase64String(Secret));
    Probe("DateTime.Parse(secret)", () => DateTime.Parse(Secret));
    Probe("JsonDocument.Parse", () => JsonDocument.Parse($"{{\"apiKey\":\"{Secret}\""));
    Probe("XElement.Parse", () => System.Xml.Linq.XElement.Parse($"<a key='{Secret}'>"));
    Probe("DbConnectionStringBuilder", () =>
    {
        var builder = new System.Data.Common.DbConnectionStringBuilder
        {
            ConnectionString = "Server=db;Password=hunter2;;;=bad"
        };

        return builder;
    });

    Console.WriteLine();
    Console.WriteLine("   TWO OUT OF EIGHT, and there is no principle that predicts which two.");
    Console.WriteLine();
    Console.WriteLine("   LOOK AT THE EXCEPTION COLUMN. Three rows throw FormatException and only");
    Console.WriteLine("   two of those three include the value. The type tells you nothing; the");
    Console.WriteLine("   behaviour is a decision made separately inside each parser.");
    Console.WriteLine();
    Console.WriteLine("   The primitive parsers quote their input because a developer debugging");
    Console.WriteLine("   a parse failure wants to see what failed to parse - which is a good");
    Console.WriteLine("   decision for every value except the ones you cannot show anybody.");
    Console.WriteLine();
    Console.WriteLine("   THE URI CASE IS THE MOST IMPORTANT ROW, and it is the clean one. It is");
    Console.WriteLine("   worth knowing that UriFormatException does NOT include the URI, because");
    Console.WriteLine("   it is the row people assume is the dangerous one - and a key in a query");
    Console.WriteLine("   string is dangerous for entirely different reasons.");
    Console.WriteLine();
    Console.WriteLine("   THE LESSON IS NOT A LIST OF SAFE APIS. You cannot audit this: the set");
    Console.WriteLine("   of exception messages your process can produce includes every library");
    Console.WriteLine("   you depend on and every version of them you will ever upgrade to.");
    Console.WriteLine();
    Console.WriteLine("   The defences that do not require the list:");
    Console.WriteLine();
    Console.WriteLine("     1. NEVER PUT A CREDENTIAL IN A URL. Put it in a header. A URL reaches");
    Console.WriteLine("        access logs, proxy logs, browser history and referrer headers");
    Console.WriteLine("        without anybody logging anything; a header reaches none of them.");
    Console.WriteLine();
    Console.WriteLine("     2. VALIDATE AND PARSE SECRETS AT STARTUP, not per request. A malformed");
    Console.WriteLine("        credential should stop the process once, where the exception goes");
    Console.WriteLine("        to somebody looking at a deployment, rather than into request logs");
    Console.WriteLine("        thousands of times.");
    Console.WriteLine();
    Console.WriteLine("     3. KEEP THE SECRET IN ONE OBJECT AND PASS THAT, not the string. A");
    Console.WriteLine("        wrapper type with a redacting ToString cannot be interpolated into");
    Console.WriteLine("        a message by accident.");
    Console.WriteLine();

    await Task.CompletedTask;

    static void Probe(string label, Func<object> action)
    {
        try
        {
            action();
            Console.WriteLine($"   {label,-32}  {"(no exception)",-23}   -");
        }
        catch (Exception exception)
        {
            string message = exception.Message.ReplaceLineEndings(" ");

            bool leaks = message.Contains("sk-live", StringComparison.Ordinal)
                || message.Contains("hunter2", StringComparison.Ordinal);

            Console.WriteLine($"   {label,-32}  {(leaks ? "YES" : "no"),-23}   {exception.GetType().Name}");
        }
    }
}

// ---------------------------------------------------------------------------
static async Task TheErrorResponse()
{
    Console.WriteLine("3. The developer exception page, one more time");
    Console.WriteLine();
    Console.WriteLine("   The same throwing endpoint under Development and Production, asked for");
    Console.WriteLine("   JSON:");
    Console.WriteLine();

    Console.WriteLine("   environment   status   the secret appears in the response");
    Console.WriteLine("   -----------   ------   ---------------------------------");

    foreach (string environment in new[] { "Development", "Production" })
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = environment
        });

        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddProblemDetails();
        builder.Services.AddExceptionHandler<CatchAll>();

        var app = builder.Build();

        if (environment == "Development")
        {
            app.UseDeveloperExceptionPage();
        }
        else
        {
            app.UseExceptionHandler();
        }

        app.MapGet("/boom", void () => throw new InvalidOperationException(
            "connect failed: Server=db.internal;Database=ledger;Password=hunter2"));

        await app.StartAsync();

        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        using var request = new HttpRequestMessage(HttpMethod.Get, "/boom");
        request.Headers.Add("Accept", "application/json");

        using HttpResponseMessage response = await http.SendAsync(request);
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {environment,-11}   {(int)response.StatusCode,6}   " +
            $"{(body.Contains("hunter2", StringComparison.Ordinal) ? "YES" : "no")}");

        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   This is the ProblemDetails module's finding, restated because it is a");
    Console.WriteLine("   secrets problem as much as an error-handling one: the developer");
    Console.WriteLine("   exception page returns the exception message, exception messages");
    Console.WriteLine("   contain whatever a driver put in them, and drivers put connection");
    Console.WriteLine("   strings in them.");
    Console.WriteLine();
    Console.WriteLine("   ONE ENVIRONMENT VARIABLE SET WRONGLY PUBLISHES YOUR DATABASE PASSWORD");
    Console.WriteLine("   TO ANYONE WHO CAN MAKE A REQUEST THAT FAILS.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheLogScope()
{
    Console.WriteLine("4. The helpful log line");
    Console.WriteLine();

    var records = new ConcurrentQueue<string>();

    using ILoggerFactory factory = LoggerFactory.Create(logging =>
    {
        logging.ClearProviders();
        logging.AddProvider(new CapturingLoggerProvider(records));
        logging.SetMinimumLevel(LogLevel.Information);
    });

    ILogger logger = factory.CreateLogger("Gateway");

    var options = new { BaseUrl = "https://gw.internal:8443", ApiKey = "sk-live-1111111111111111" };

    // Three ways somebody logs "what am I about to do".
    logger.LogInformation("Calling gateway with settings {Options}", options);
    logger.LogInformation("Calling {Url}", $"{options.BaseUrl}/capture?api_key={options.ApiKey}");
    logger.LogInformation("Calling {Url} with key {Key}", $"{options.BaseUrl}/capture",
        Fingerprint(options.ApiKey));

    Console.WriteLine("   what was logged:");
    Console.WriteLine();

    int line = 0;

    foreach (string record in records)
    {
        Console.WriteLine($"     {++line}. {Shorten(record)}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE FIRST TWO LEAK AND THE THIRD DOES NOT, and the difference is not");
    Console.WriteLine("   carefulness - it is what was passed in.");
    Console.WriteLine();
    Console.WriteLine("   LINE 1 IS THE ONE PEOPLE DO NOT EXPECT. Logging an options object");
    Console.WriteLine("   calls ToString on it, and a record or an anonymous type prints every");
    Console.WriteLine("   property. Structured logging makes this worse rather than better,");
    Console.WriteLine("   because a destructured object goes into the log store as fields you");
    Console.WriteLine("   can search.");
    Console.WriteLine();
    Console.WriteLine("   THE DEFENCES, in order of how much they buy:");
    Console.WriteLine();
    Console.WriteLine("     1. NEVER LOG AN OPTIONS OBJECT. Log the specific fields you need.");
    Console.WriteLine();
    Console.WriteLine("     2. GIVE SECRET-CARRYING TYPES A ToString THAT REDACTS. An options");
    Console.WriteLine("        class with an override is a class that cannot leak by accident:");
    Console.WriteLine();
    Console.WriteLine("          public override string ToString() =>");
    Console.WriteLine("              $\"BaseUrl={BaseUrl}, ApiKey=***\";");
    Console.WriteLine();
    Console.WriteLine("     3. LOG A FINGERPRINT RATHER THAN A VALUE. A prefix plus a hash tells");
    Console.WriteLine("        you which credential was in use - which is the actual question");
    Console.WriteLine("        during an incident - and cannot be used to authenticate.");
    Console.WriteLine();

    await Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static void Elsewhere()
{
    Console.WriteLine("5. The two that no C# program can demonstrate");
    Console.WriteLine();
    Console.WriteLine("   SOURCE CONTROL. A credential committed to a repository is disclosed to");
    Console.WriteLine("   everybody with read access, and stays disclosed after it is deleted,");
    Console.WriteLine("   because the commit that added it remains in the history and in every");
    Console.WriteLine("   clone anybody has taken.");
    Console.WriteLine();
    Console.WriteLine("   That is the reason for the whole design in this module. It is not that");
    Console.WriteLine("   committed secrets are untidy; it is that THE ONLY FIX IS ROTATION, and");
    Console.WriteLine("   rewriting history does not help because the clones are already made.");
    Console.WriteLine();
    Console.WriteLine("   What stops it:");
    Console.WriteLine();
    Console.WriteLine("     - no committed file ever holds a value, so there is nothing to");
    Console.WriteLine("       commit by accident;");
    Console.WriteLine("     - .gitignore covers appsettings.*.local.json and anything similar;");
    Console.WriteLine("     - a pre-commit or CI secret scanner, which catches the case where");
    Console.WriteLine("       somebody pastes a value into a file that is normally safe.");
    Console.WriteLine();
    Console.WriteLine("   CONTAINER IMAGES AND BUILD LOGS. A secret passed as a Docker build");
    Console.WriteLine("   argument is recorded in the image metadata; one echoed by a build step");
    Console.WriteLine("   is in the CI log; one written into a layer is in the image even if a");
    Console.WriteLine("   later layer deletes the file.");
    Console.WriteLine();
    Console.WriteLine("   The rule that covers all three: SECRETS ARE SUPPLIED AT RUN TIME, NOT");
    Console.WriteLine("   BUILD TIME. An image should be identical for every environment, which");
    Console.WriteLine("   means it cannot contain anything environment-specific - and that is");
    Console.WriteLine("   also what lets the same artefact be promoted from staging to");
    Console.WriteLine("   production rather than rebuilt.");
}

// ---------------------------------------------------------------------------
static bool IsSensitive(string key) =>
    key.Contains("key", StringComparison.OrdinalIgnoreCase)
    || key.Contains("secret", StringComparison.OrdinalIgnoreCase)
    || key.Contains("password", StringComparison.OrdinalIgnoreCase)
    || key.Contains("token", StringComparison.OrdinalIgnoreCase)
    || key.Contains("connectionstring", StringComparison.OrdinalIgnoreCase);

static string Fingerprint(string secret)
{
    byte[] hash = System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(secret));

    return $"{secret[..7]}... sha256:{Convert.ToHexString(hash)[..8].ToLowerInvariant()}";
}

static string Shorten(string text)
{
    string flat = text.ReplaceLineEndings(" ");

    return flat.Length > 120 ? flat[..120] + "..." : flat;
}

// ---------------------------------------------------------------------------
public sealed class CatchAll(IProblemDetailsService problemDetails,
    ILogger<CatchAll> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception,
        CancellationToken cancellationToken)
    {
        logger.LogError(exception, "Unhandled exception");
        context.Response.StatusCode = 500;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            ProblemDetails = { Title = "An unexpected error occurred", Status = 500 }
        });
    }
}

public sealed class CapturingLoggerProvider(ConcurrentQueue<string> records) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new Capturing(records);

    public void Dispose() { }

    private sealed class Capturing(ConcurrentQueue<string> records) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            string message = formatter(state, exception);

            records.Enqueue(exception is null
                ? message
                : $"{message} || {exception.GetType().Name}: {exception.Message}");
        }
    }
}
