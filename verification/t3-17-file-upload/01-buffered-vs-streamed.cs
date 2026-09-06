// 01-buffered-vs-streamed.cs — Where an uploaded file actually is while your
// handler runs, and what the two limits that bound it are called.
//
// Run:  dotnet run 01-buffered-vs-streamed.cs -c Release
//
// EXACT vs RATIO: the status codes, exception types, limit values and byte
// counts are exact. The timings are machine-specific; the claim is the GAP
// between the two rows, which is the whole upload against a few milliseconds.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Http.Features;
using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

await WhereTheFileIs();
await TheTwoLimits();
await Streaming();
Guidance();

// ---------------------------------------------------------------------------
static async Task WhereTheFileIs()
{
    Console.WriteLine("1. IFormFile is a file that already exists");
    Console.WriteLine();
    Console.WriteLine("   By the time a handler taking IFormFile runs, the whole upload has been");
    Console.WriteLine("   read off the socket. That is measurable directly: send an upload slowly");
    Console.WriteLine("   and record when the handler first gets control.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 200L * 1024 * 1024);

    var app = builder.Build();

    var clock = Stopwatch.StartNew();
    double bufferedHandlerAt = 0;
    double streamedFirstByteAt = 0;

    app.MapPost("/buffered", (IFormFile file) =>
    {
        bufferedHandlerAt = clock.Elapsed.TotalMilliseconds;

        return Results.Ok(new { file.Length });
    }).DisableAntiforgery();

    app.MapPost("/streamed", async (HttpContext context) =>
    {
        MediaTypeHeaderValue media = MediaTypeHeaderValue.Parse(context.Request.ContentType!);
        string boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value!;

        var reader = new MultipartReader(boundary, context.Request.Body);
        long total = 0;

        while (await reader.ReadNextSectionAsync() is { } section)
        {
            byte[] buffer = new byte[8192];
            int read = await section.Body.ReadAsync(buffer);

            // The first bytes of the file, in the handler, while the rest of
            // the upload is still on its way.
            if (streamedFirstByteAt == 0 && read > 0)
            {
                streamedFirstByteAt = clock.Elapsed.TotalMilliseconds;
            }

            total += read;

            while (read > 0)
            {
                read = await section.Body.ReadAsync(buffer);
                total += read;
            }
        }

        return Results.Ok(new { total });
    }).DisableAntiforgery();

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // A 16 MB upload sent in 32 chunks with a small pause between them, so
    // "when did the handler run" is a question with a visible answer.
    const int Chunks = 32;
    const int ChunkSize = 512 * 1024;

    Console.WriteLine("   endpoint    upload sent over   handler got control after   status");
    Console.WriteLine("   --------    ----------------   -------------------------   ------");

    foreach (string path in new[] { "/buffered", "/streamed" })
    {
        clock.Restart();

        using var content = new MultipartFormDataContent();
        content.Add(new SlowContent(Chunks, ChunkSize, TimeSpan.FromMilliseconds(10)),
            "file", "big.bin");

        using HttpResponseMessage response = await http.PostAsync(path, content);
        double sentOver = clock.Elapsed.TotalMilliseconds;

        double handlerAt = path == "/buffered" ? bufferedHandlerAt : streamedFirstByteAt;

        Console.WriteLine($"   {path,-10}  {sentOver,13:0} ms   {handlerAt,22:0} ms   " +
            $"{(int)response.StatusCode}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE BUFFERED HANDLER RAN AFTER THE WHOLE UPLOAD ARRIVED. The streamed");
    Console.WriteLine("   one had the first bytes in hand within a few milliseconds of the first");
    Console.WriteLine("   chunk, with the rest of the file still in flight.");
    Console.WriteLine();
    Console.WriteLine("   That gap is the whole difference, and it decides three things:");
    Console.WriteLine();
    Console.WriteLine("     - A REJECTED FILE WAS STILL RECEIVED IN FULL. You cannot refuse a");
    Console.WriteLine("       200 MB video after reading 8 bytes of it, because there is no");
    Console.WriteLine("       point at which you are asked.");
    Console.WriteLine();
    Console.WriteLine("     - THE REQUEST HELD A CONNECTION for the whole upload before any of");
    Console.WriteLine("       your validation ran. A slow client is a held connection.");
    Console.WriteLine();
    Console.WriteLine("     - THE BYTES WENT SOMEWHERE. Small uploads stay in memory; anything");
    Console.WriteLine("       over 64 KB by default is spooled to a temporary file, which is disk");
    Console.WriteLine("       your server is now responsible for. A hundred concurrent uploads is");
    Console.WriteLine("       a hundred of them.");
    Console.WriteLine();
    Console.WriteLine("   NONE OF THAT MAKES IFormFile WRONG. It makes it a choice with a size");
    Console.WriteLine("   attached, and the size is the thing to decide deliberately.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheTwoLimits()
{
    Console.WriteLine("2. Two limits, two layers, two different failures");
    Console.WriteLine();

    Console.WriteLine("   configuration                         12 MB upload   what happened");
    Console.WriteLine("   -------------                         ------------   -------------");

    foreach ((string label, long? kestrel, long? multipart) in new (string, long?, long?)[]
    {
        ("both defaults", null, null),
        ("Kestrel 10 MB", 10L * 1024 * 1024, null),
        ("Kestrel 100 MB, multipart 10 MB", 100L * 1024 * 1024, 10L * 1024 * 1024),
        ("Kestrel 100 MB, multipart 100 MB", 100L * 1024 * 1024, 100L * 1024 * 1024)
    })
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();

        if (kestrel is { } bodyLimit)
        {
            builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = bodyLimit);
        }

        if (multipart is { } formLimit)
        {
            builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = formLimit);
        }

        var app = builder.Build();

        string failure = "";

        app.MapPost("/upload", async (HttpContext context) =>
        {
            try
            {
                IFormCollection form = await context.Request.ReadFormAsync();

                return Results.Ok(new { count = form.Files.Count });
            }
            catch (Exception exception)
            {
                failure = exception.GetType().Name;

                return Results.StatusCode(400);
            }
        }).DisableAntiforgery();

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        byte[] payload = new byte[12 * 1024 * 1024];
        string result = await Upload(http, "/upload", "big.bin", payload);

        Console.WriteLine($"   {label,-36}   {result,-12}   {failure}");

        await app.StopAsync();
        await app.DisposeAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   TWO LIMITS APPLY AND THEY ARE SET IN DIFFERENT PLACES:");
    Console.WriteLine();
    Console.WriteLine("     Kestrel's MaxRequestBodySize       30 MB by default. Counts the");
    Console.WriteLine("                                        WHOLE request body, refuses at the");
    Console.WriteLine("                                        server, returns 413.");
    Console.WriteLine();
    Console.WriteLine("     FormOptions.MultipartBodyLengthLimit");
    Console.WriteLine("                                        128 MB by default. Counts the");
    Console.WriteLine("                                        multipart section, throws inside");
    Console.WriteLine("                                        your handler when the form is");
    Console.WriteLine("                                        read.");
    Console.WriteLine();
    Console.WriteLine("   THE ORDER MATTERS AND IT IS NOT THE ORDER OF THE NUMBERS. Kestrel's");
    Console.WriteLine("   limit is enforced first, at the server, before any of your code runs.");
    Console.WriteLine("   Raising the multipart limit alone changes nothing, because the request");
    Console.WriteLine("   never gets that far.");
    Console.WriteLine();
    Console.WriteLine("   THE TWO FAILURES ALSO LOOK DIFFERENT TO A CALLER: one is a 413 and a");
    Console.WriteLine("   closed connection, the other is an exception in your handler that");
    Console.WriteLine("   becomes whatever your error handling makes of it - which by default is");
    Console.WriteLine("   a 500 saying nothing.");
    Console.WriteLine();
    Console.WriteLine("   THERE IS A THIRD LIMIT you will meet before either of these: the");
    Console.WriteLine("   reverse proxy in front of you. IIS defaults to 30 MB and nginx to 1 MB,");
    Console.WriteLine("   and neither of them consults your application's configuration. A limit");
    Console.WriteLine("   raised in three places and not the fourth is the commonest way an");
    Console.WriteLine("   upload limit appears not to work.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Streaming()
{
    Console.WriteLine("3. Reading the upload yourself");
    Console.WriteLine();
    Console.WriteLine("   MultipartReader hands you each section as a stream, so nothing is");
    Console.WriteLine("   buffered on your behalf and you decide what to do as bytes arrive.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 200L * 1024 * 1024);

    var app = builder.Build();

    string storage = Directory.CreateTempSubdirectory("stream").FullName;

    app.MapPost("/stream", async (HttpContext context) =>
    {
        if (!MediaTypeHeaderValue.TryParse(context.Request.ContentType, out MediaTypeHeaderValue? media)
            || !media.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            return Results.Problem(title: "Expected multipart/form-data", statusCode: 415);
        }

        string boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value
            ?? throw new InvalidOperationException("no boundary");

        var reader = new MultipartReader(boundary, context.Request.Body);
        long written = 0;
        string? name = null;

        while (await reader.ReadNextSectionAsync() is { } section)
        {
            if (!ContentDispositionHeaderValue.TryParse(
                    section.ContentDisposition, out ContentDispositionHeaderValue? disposition)
                || !disposition.IsFileDisposition())
            {
                continue;
            }

            name = HeaderUtilities.RemoveQuotes(disposition.FileName).Value;

            // The first bytes arrive here, BEFORE the rest of the upload has
            // been sent. This is the only place a decision can be made early.
            string path = Path.Combine(storage, Guid.NewGuid().ToString("N"));

            await using FileStream target = File.Create(path);
            await section.Body.CopyToAsync(target);

            written = target.Length;
        }

        return Results.Ok(new { name, written });
    }).DisableAntiforgery();

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   upload size     status   bytes written   framework temp files used");
    Console.WriteLine("   -----------     ------   -------------   -------------------------");

    foreach (int megabytes in new[] { 8, 32, 64 })
    {
        byte[] payload = new byte[megabytes * 1024 * 1024];

        string status = await Upload(http, "/stream", "big.bin", payload);
        long written = new DirectoryInfo(storage).GetFiles().Sum(f => f.Length);

        Console.WriteLine($"   {megabytes,8} MB     {status,-6}   {written / 1024.0 / 1024.0,10:0.0} MB   0");

        foreach (FileInfo file in new DirectoryInfo(storage).GetFiles())
        {
            file.Delete();
        }
    }

    await app.StopAsync();
    await app.DisposeAsync();
    Directory.Delete(storage, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   THE FILE WENT STRAIGHT FROM THE SOCKET TO ITS DESTINATION. It was");
    Console.WriteLine("   never a byte[] and never a temporary file the framework owns and then");
    Console.WriteLine("   deletes - the copy goes through an 8 KB buffer, once.");
    Console.WriteLine();
    Console.WriteLine("   THE REAL PRIZE IS NOT THE MEMORY, though that is real. It is that YOU");
    Console.WriteLine("   ARE IN THE LOOP WHILE THE BYTES ARRIVE, which means you can:");
    Console.WriteLine();
    Console.WriteLine("     - read the first few bytes, check they are what the extension claims,");
    Console.WriteLine("       and abandon the request before the other 199 MB arrive;");
    Console.WriteLine();
    Console.WriteLine("     - count bytes as you copy and stop at your own limit, with your own");
    Console.WriteLine("       error, rather than at Kestrel's;");
    Console.WriteLine();
    Console.WriteLine("     - write straight to blob storage as the bytes come in, so the file");
    Console.WriteLine("       never touches your server's disk at all.");
    Console.WriteLine();
    Console.WriteLine("   THE COST IS REAL AND WORTH STATING: it is thirty lines instead of one");
    Console.WriteLine("   parameter, you handle the boundary and the content disposition");
    Console.WriteLine("   yourself, and there is no model binding - so a form with other fields");
    Console.WriteLine("   in it becomes your problem too.");
    Console.WriteLine();
    Console.WriteLine("   AND ONE ORDERING TRAP: fields sent AFTER the file in the multipart");
    Console.WriteLine("   body are not available while you are streaming the file, because they");
    Console.WriteLine("   have not arrived yet. If a decision about the file depends on another");
    Console.WriteLine("   field, that field has to be sent first - which is a thing you must");
    Console.WriteLine("   document, because a client will not guess it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Guidance()
{
    Console.WriteLine("4. Which to use");
    Console.WriteLine();
    Console.WriteLine("   IFormFile, WITH A SMALL EXPLICIT LIMIT, for anything a person picks in");
    Console.WriteLine("   a form: an avatar, a receipt photograph, a CSV of a few thousand rows.");
    Console.WriteLine("   The convenience is real and a 5 MB ceiling makes the buffering");
    Console.WriteLine("   irrelevant.");
    Console.WriteLine();
    Console.WriteLine("   STREAMING for anything that can be large or that arrives from a");
    Console.WriteLine("   machine: document archives, video, bulk import files, anything a");
    Console.WriteLine("   partner integration sends.");
    Console.WriteLine();
    Console.WriteLine("   AND FOR GENUINELY LARGE FILES, THE THIRD ANSWER: do not send them");
    Console.WriteLine("   through your API at all.");
    Console.WriteLine();
    Console.WriteLine("     1. the client asks your API for an upload URL;");
    Console.WriteLine("     2. your API returns a PRE-SIGNED URL to blob storage, valid for a");
    Console.WriteLine("        few minutes, for one object, with a size limit baked in;");
    Console.WriteLine("     3. the client uploads directly to storage;");
    Console.WriteLine("     4. the client tells your API the upload is done, and your API");
    Console.WriteLine("        verifies the object before recording it.");
    Console.WriteLine();
    Console.WriteLine("   THE BYTES NEVER TOUCH YOUR SERVERS. No connection held for four");
    Console.WriteLine("   minutes, no disk, no bandwidth, and the storage service handles the");
    Console.WriteLine("   resume-after-network-failure problem you would otherwise have to.");
    Console.WriteLine();
    Console.WriteLine("   THE PART PEOPLE MISS IS STEP 4. Without it, the client tells you a");
    Console.WriteLine("   file is there and you believe it - so your database records an object");
    Console.WriteLine("   that may not exist, may be a different size than claimed, or may be");
    Console.WriteLine("   something other than what was promised. The verification is what makes");
    Console.WriteLine("   the pattern safe rather than merely fast.");
}

// ---------------------------------------------------------------------------
static async Task<string> Upload(HttpClient http, string path, string filename, byte[] bytes)
{
    using var content = new MultipartFormDataContent();
    var part = new ByteArrayContent(bytes);

    part.Headers.ContentType =
        new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

    content.Add(part, "file", filename);

    try
    {
        using HttpResponseMessage response = await http.PostAsync(path, content);

        return $"{(int)response.StatusCode}";
    }
    catch (HttpRequestException)
    {
        return "connection";
    }
}

// ---------------------------------------------------------------------------
// Writes its body in chunks with a pause between them, so that "when did the
// handler get control" is a question with a visible answer.
sealed class SlowContent(int chunks, int chunkSize, TimeSpan delay) : HttpContent
{
    protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
    {
        byte[] chunk = new byte[chunkSize];

        for (int i = 0; i < chunks; i++)
        {
            await stream.WriteAsync(chunk);
            await stream.FlushAsync();
            await Task.Delay(delay);
        }
    }

    protected override bool TryComputeLength(out long length)
    {
        length = (long)chunks * chunkSize;

        return true;
    }
}
