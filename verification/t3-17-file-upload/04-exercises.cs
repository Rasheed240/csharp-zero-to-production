// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: the counts, byte totals and status codes are deterministic.
// Exercise 4's figures are scaled down to run in a few seconds - the narrative
// describes a customer whose export was hundreds of times larger, and the claim
// is the RATIO between the two rows, not the absolute times.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

await One();
Two();
await Three();
await Four();

// ---------------------------------------------------------------------------
static async Task One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the endpoint that works everywhere but production");
    Console.WriteLine();
    Console.WriteLine("   An endpoint accepts document uploads. It works on every developer");
    Console.WriteLine("   machine and in the integration tests. In production, uploads over");
    Console.WriteLine("   about 30 MB fail with no useful error, and the handler's logging - the");
    Console.WriteLine("   first line of which logs the filename - prints nothing at all.");
    Console.WriteLine();
    Console.WriteLine("   Where is the limit, and why does no log line appear?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();

    bool handlerRan = false;

    app.MapPost("/documents", (IFormFile file) =>
    {
        handlerRan = true;

        return Results.Ok();
    }).DisableAntiforgery();

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   upload size   handler ran   result");
    Console.WriteLine("   -----------   -----------   ------");

    foreach (int megabytes in new[] { 20, 40 })
    {
        handlerRan = false;

        string result = await Post(http, "/documents", megabytes * 1024 * 1024);

        Console.WriteLine($"   {megabytes,8} MB   {handlerRan,-11}   {result}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE LIMIT IS KESTREL'S MaxRequestBodySize, 30 MB by default,");
    Console.WriteLine("   AND NOBODY IN THE TEAM SET IT. Nothing in the endpoint mentions a");
    Console.WriteLine("   size, which is why nobody could find it by reading the endpoint.");
    Console.WriteLine();
    Console.WriteLine("   THE HANDLER NEVER RAN, which is why there is no log line. A handler");
    Console.WriteLine("   taking IFormFile does not begin until the whole body has been read,");
    Console.WriteLine("   so a body refused during the read is refused BEFORE your first log");
    Console.WriteLine("   statement. Silence in the handler's log is EVIDENCE, not an absence");
    Console.WriteLine("   of evidence: it locates the failure above the handler.");
    Console.WriteLine();
    Console.WriteLine("   WHY IT PASSED EVERYWHERE ELSE: test fixtures use small files, and");
    Console.WriteLine("   developers upload the sample document in the repository. NOBODY EVER");
    Console.WriteLine("   TESTED THE LIMIT because nobody knew there was one to test.");
    Console.WriteLine();
    Console.WriteLine("   TO RAISE IT you set it in two places, and which two depends on how you");
    Console.WriteLine("   read the body: Kestrel's MaxRequestBodySize for the whole request, and");
    Console.WriteLine("   FormOptions.MultipartBodyLengthLimit if you bind to IFormFile. Setting");
    Console.WriteLine("   one and not the other moves the error rather than removing it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the avatars that overwrote each other");
    Console.WriteLine();
    Console.WriteLine("   A profile service stores avatars under the uploaded filename, in a");
    Console.WriteLine("   directory per user. Support reports that a user opened their profile");
    Console.WriteLine("   and saw a photograph of someone else.");
    Console.WriteLine();
    Console.WriteLine("   The filename is passed through Path.GetFileName, so it cannot escape");
    Console.WriteLine("   the directory - and it did not. What happened instead?");
    Console.WriteLine();

    string root = Directory.CreateTempSubdirectory("avatars").FullName;

    // Two users, each with their own directory, each uploading from a phone.
    (string User, string Filename, string Content)[] uploads =
    [
        ("user-1001", "IMG_0001.JPG", "photo of user 1001"),
        ("user-1002", "IMG_0001.JPG", "photo of user 1002"),
        ("user-1001", "IMG_0001.JPG", "a NEW photo of user 1001")
    ];

    Console.WriteLine("   user        uploaded as    stored at                        overwrote");
    Console.WriteLine("   ----        -----------    ---------                        ---------");

    foreach ((string user, string filename, string content) in uploads)
    {
        string directory = Path.Combine(root, user);
        Directory.CreateDirectory(directory);

        string leaf = Path.GetFileName(filename);
        string path = Path.Combine(directory, leaf);

        bool existed = File.Exists(path);
        File.WriteAllText(path, content);

        Console.WriteLine($"   {user,-11} {filename,-14} {Path.GetRelativePath(root, path),-32} {(existed ? "YES" : "no")}");
    }

    Console.WriteLine();
    Console.WriteLine("   files on disk:");

    foreach (string file in Directory.GetFiles(root, "*", SearchOption.AllDirectories))
    {
        Console.WriteLine($"     {Path.GetRelativePath(root, file),-32} {File.ReadAllText(file)}");
    }

    Directory.Delete(root, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   ANSWER: NOTHING IN THE TABLE ABOVE IS THE BUG. Every file landed in");
    Console.WriteLine("   the right user's directory and nothing was overwritten across users -");
    Console.WriteLine("   phones name every photo IMG_0001.JPG, but the directory keeps them");
    Console.WriteLine("   apart. THE ONLY COLLISION IS A USER OVERWRITING THEMSELVES, which is");
    Console.WriteLine("   what an avatar is supposed to do.");
    Console.WriteLine();
    Console.WriteLine("   SO THE PHOTO CAME FROM SOMEWHERE ELSE, and the candidates are all");
    Console.WriteLine("   downstream of storage:");
    Console.WriteLine();
    Console.WriteLine("     A CACHE KEYED ON THE FILENAME. A CDN or a proxy asked to cache");
    Console.WriteLine("     '/avatars/IMG_0001.JPG' has one entry for every user who owns a");
    Console.WriteLine("     photo with that name. THE FILENAME IS NOT UNIQUE and you have made");
    Console.WriteLine("     it the cache key.");
    Console.WriteLine();
    Console.WriteLine("     A URL THAT IS GUESSABLE. If the avatar is served from a path");
    Console.WriteLine("     containing the filename, one user can request another's by name.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS THE SAME ONE THAT FIXES THE PATH PROBLEMS: a generated,");
    Console.WriteLine("   unique name on disk and in the URL, with the original filename kept");
    Console.WriteLine("   as data. THE LESSON IS THAT 'IT CANNOT ESCAPE THE DIRECTORY' AND 'IT");
    Console.WriteLine("   IS SAFE TO USE AS AN IDENTIFIER' ARE DIFFERENT CLAIMS, and passing");
    Console.WriteLine("   the filename through GetFileName only establishes the first.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Three()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the validation that ran too late");
    Console.WriteLine();
    Console.WriteLine("   An endpoint accepts CSV imports up to 50 MB. It checks the extension");
    Console.WriteLine("   and rejects anything that is not '.csv'. A load test sends 200 MB of");
    Console.WriteLine("   '.exe' files that are rejected correctly, and the service falls over.");
    Console.WriteLine();
    Console.WriteLine("   Every request returned 400. Why did rejecting them cost anything?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 60L * 1024 * 1024);
    builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = 60L * 1024 * 1024);

    var app = builder.Build();

    long bufferedBytesRead = 0;
    long streamedBytesRead = 0;

    // As written: the extension check is inside the handler, and the handler
    // takes IFormFile.
    app.MapPost("/import-buffered", (IFormFile file) =>
    {
        bufferedBytesRead += file.Length;

        return Path.GetExtension(file.FileName) == ".csv"
            ? Results.Ok()
            : Results.BadRequest();
    }).DisableAntiforgery();

    // The same rule, checked against the section headers before the body.
    app.MapPost("/import-streamed", async (HttpContext context) =>
    {
        MediaTypeHeaderValue media = MediaTypeHeaderValue.Parse(context.Request.ContentType!);
        string boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value!;

        var reader = new MultipartReader(boundary, context.Request.Body);

        while (await reader.ReadNextSectionAsync() is { } section)
        {
            ContentDispositionHeaderValue disposition =
                ContentDispositionHeaderValue.Parse(section.ContentDisposition!);

            string name = HeaderUtilities.RemoveQuotes(disposition.FileName).Value ?? "";

            if (Path.GetExtension(name) != ".csv")
            {
                return Results.BadRequest();
            }

            byte[] buffer = new byte[8192];
            int read;

            while ((read = await section.Body.ReadAsync(buffer)) > 0)
            {
                streamedBytesRead += read;
            }
        }

        return Results.Ok();
    }).DisableAntiforgery();

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   endpoint            status   bytes the handler took delivery of");
    Console.WriteLine("   --------            ------   ----------------------------------");

    string a = await Post(http, "/import-buffered", 20 * 1024 * 1024, "payload.exe");
    Console.WriteLine($"   /import-buffered    {a,-6}   {bufferedBytesRead / 1024.0 / 1024.0,10:0.0} MB");

    string b = await Post(http, "/import-streamed", 20 * 1024 * 1024, "payload.exe");
    Console.WriteLine($"   /import-streamed    {b,-6}   {streamedBytesRead / 1024.0 / 1024.0,10:0.0} MB");

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE BUFFERED ENDPOINT READ ALL 20 MB BEFORE IT WAS ASKED THE");
    Console.WriteLine("   QUESTION. Binding to IFormFile means the framework reads the whole");
    Console.WriteLine("   body, spools anything over 64 KB to a temporary file, and only then");
    Console.WriteLine("   invokes your handler. YOUR VALIDATION IS THE LAST THING THAT RUNS, no");
    Console.WriteLine("   matter where you write it in the method.");
    Console.WriteLine();
    Console.WriteLine("   SO THE LOAD TEST COST, PER REJECTED REQUEST: a full 20 MB transfer, a");
    Console.WriteLine("   20 MB temporary file written and deleted, and a connection held for");
    Console.WriteLine("   the duration. Multiply by the concurrency and the disk, not the CPU,");
    Console.WriteLine("   is what gives way.");
    Console.WriteLine();
    Console.WriteLine("   THE STREAMED ENDPOINT ANSWERED FROM THE SECTION HEADERS. The filename");
    Console.WriteLine("   arrives in the multipart headers, ahead of the bytes, so the rejection");
    Console.WriteLine("   costs a few hundred bytes instead of twenty megabytes.");
    Console.WriteLine();
    Console.WriteLine("   THE PRINCIPLE GENERALISES BEYOND UPLOADS: A CHECK IS ONLY CHEAP IF IT");
    Console.WriteLine("   RUNS BEFORE THE EXPENSIVE THING. Validation written after the work has");
    Console.WriteLine("   happened returns the right answer at the wrong price, and a load test");
    Console.WriteLine("   is the only thing that will tell you, because functionally it is");
    Console.WriteLine("   perfect.");
    Console.WriteLine();
    Console.WriteLine("   AND THE EXTENSION CHECK IS STILL THE WRONG CHECK - it is the client's");
    Console.WriteLine("   string. Moving it earlier makes it cheap; it does not make it true.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the export that was fine until it was not");
    Console.WriteLine();
    Console.WriteLine("   A reporting service builds a CSV export and returns it. It has run for");
    Console.WriteLine("   two years. This month, one customer's export started timing out at");
    Console.WriteLine("   sixty seconds, and while it runs, the service's memory doubles.");
    Console.WriteLine();
    Console.WriteLine("   The database query takes four seconds. Where do the other fifty-six");
    Console.WriteLine("   go, and why does memory move at all?");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();

    // As written: build the whole file, then send it.
    app.MapGet("/export-buffered", () =>
    {
        var csv = new StringBuilder();

        for (int row = 0; row < 200_000; row++)
        {
            csv.AppendLine($"{row},PAY-{row:000000},captured,{row * 100}");
        }

        return Results.Text(csv.ToString(), "text/csv");
    });

    // The same export, written to the response as it is produced.
    app.MapGet("/export-streamed", async (HttpContext context) =>
    {
        context.Response.ContentType = "text/csv";

        await using var writer = new StreamWriter(context.Response.Body);

        for (int row = 0; row < 200_000; row++)
        {
            await writer.WriteLineAsync($"{row},PAY-{row:000000},captured,{row * 100}");
        }
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   endpoint            server memory for the export   first byte to client");
    Console.WriteLine("   --------            ----------------------------   --------------------");

    foreach (string path in new[] { "/export-buffered", "/export-streamed" })
    {
        long before = GC.GetTotalAllocatedBytes(precise: true);
        var clock = System.Diagnostics.Stopwatch.StartNew();

        using HttpResponseMessage response =
            await http.GetAsync(path, HttpCompletionOption.ResponseHeadersRead);

        await using Stream body = await response.Content.ReadAsStreamAsync();
        int first = body.ReadByte();

        double firstByteMs = clock.Elapsed.TotalMilliseconds;

        await body.CopyToAsync(Stream.Null);

        long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

        Console.WriteLine($"   {path,-19} {allocated / 1024.0 / 1024.0,20:0} MB   {firstByteMs,17:0} ms");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   (The run above is scaled down to a few hundred milliseconds. The");
    Console.WriteLine("   customer's export was hundreds of times larger; the ratio is the point.)");
    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE FIFTY-SIX SECONDS ARE SPENT BUILDING A STRING NOBODY IS");
    Console.WriteLine("   WAITING TO SEE THE END OF. The handler assembles the entire CSV in");
    Console.WriteLine("   memory, then hands the finished object to the framework, which writes");
    Console.WriteLine("   it. The client receives nothing until the last row is formatted.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE SAME SHAPE AS IFormFile, POINTING THE OTHER WAY. On the");
    Console.WriteLine("   way in, buffering means your code starts after the last byte arrives.");
    Console.WriteLine("   On the way out, it means the client starts after your last byte is");
    Console.WriteLine("   produced. ONE MENTAL MODEL COVERS BOTH: work that is buffered is work");
    Console.WriteLine("   that has to finish before anything else can begin.");
    Console.WriteLine();
    Console.WriteLine("   THE MEMORY IS THE SECOND HALF, and it is worse than the table shows.");
    Console.WriteLine("   The buffered export holds the whole file per concurrent request. Ten");
    Console.WriteLine("   customers exporting at once is ten copies. It survived two years");
    Console.WriteLine("   because exports were small and rare, and both of those are properties");
    Console.WriteLine("   of your customers rather than of your code.");
    Console.WriteLine();
    Console.WriteLine("   WHY THE TIMEOUT ARRIVED THIS MONTH: one customer crossed a size that");
    Console.WriteLine("   pushed the build past sixty seconds. NOTHING CHANGED IN THE SERVICE.");
    Console.WriteLine("   THE FAILURE MODE WAS ALWAYS THERE, waiting for a large enough account,");
    Console.WriteLine("   which is the defining property of a limit you did not choose.");
    Console.WriteLine();
    Console.WriteLine("   AND THE FIX IS FREE OF THE TIMEOUT AS WELL AS THE MEMORY: a streamed");
    Console.WriteLine("   response sends its first bytes immediately, so the proxy and the");
    Console.WriteLine("   client see an active connection throughout. A sixty-second idle");
    Console.WriteLine("   timeout never fires on a connection that has never been idle.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task<string> Post(HttpClient http, string path, int size, string filename = "f.bin")
{
    using var content = new MultipartFormDataContent();
    content.Add(new ByteArrayContent(new byte[size]), "file", filename);

    try
    {
        using HttpResponseMessage response = await http.PostAsync(path, content);

        return $"{(int)response.StatusCode}";
    }
    catch (Exception exception)
    {
        return exception.GetType().Name;
    }
}
